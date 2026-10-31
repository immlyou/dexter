import { isIP } from 'node:net'
import type { Context, MiddlewareHandler } from 'hono'

const DEFAULT_MAX_KEYS = 50_000
// Expired windows are swept at least this often, whatever the window length
const MAX_SWEEP_INTERVAL_MS = 60_000

/**
 * In-memory fixed-window rate limiter. Single-process only: state is lost on restart
 * and not shared between replicas (use Redis or similar when scaling out).
 * The key map is bounded: expired windows are swept periodically and, when `maxKeys`
 * is reached, entries with the fewest hits (oldest first on ties) are evicted. Rejecting
 * new keys instead would let a flood of fresh keys lock out every new client, while
 * evicting by age would let it reset counters under attack: displacing a counter at N
 * hits requires filling the whole map with counters at >= N hits.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()
  private lastSweep = 0

  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
    readonly maxKeys: number = DEFAULT_MAX_KEYS
  ) {}

  /** Record a hit for `key`; returns whether it is allowed and when to retry. */
  hit(key: string): { allowed: boolean; retryAfterSec: number; refund: () => void } {
    const now = this.now()
    this.sweep(now)

    let entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      // A new entry keeps late refunds from decrementing a subsequent window.
      this.hits.delete(key)
      if (this.hits.size >= this.maxKeys) this.sweep(now, true)
      if (this.hits.size >= this.maxKeys) this.evictLowest()
      entry = { count: 0, resetAt: now + this.windowMs }
      this.hits.set(key, entry)
    }
    const allowed = entry.count < this.max
    if (allowed) entry.count++
    let refunded = false
    return {
      allowed,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      refund: () => {
        if (allowed && !refunded) {
          entry.count--
          if (entry.count === 0 && this.hits.get(key) === entry) this.hits.delete(key)
        }
        refunded = true
      }
    }
  }

  get size(): number {
    return this.hits.size
  }

  reset(): void {
    this.hits.clear()
  }

  /**
   * Evict up to 1% of `maxKeys` entries at the lowest count (oldest first), so the O(n)
   * scans run once per batch of new keys instead of once per new key.
   */
  private evictLowest(): void {
    let lowest = Infinity
    for (const entry of this.hits.values()) {
      if (entry.count < lowest) lowest = entry.count
      if (lowest <= 1) break
    }
    let budget = Math.max(1, Math.floor(this.maxKeys / 100))
    // Map iteration is insertion order, so the oldest minimum-count entries go first
    for (const [key, entry] of this.hits) {
      if (budget === 0) break
      if (entry.count === lowest) {
        this.hits.delete(key)
        budget--
      }
    }
  }

  private sweep(now: number, force = false): void {
    if (!force && now - this.lastSweep < Math.min(this.windowMs, MAX_SWEEP_INTERVAL_MS)) return
    this.lastSweep = now
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key)
    }
  }
}

/**
 * Per-user cap on simultaneously running work (e.g. agent queries).
 */
export class ConcurrencyLimiter {
  private readonly active = new Map<string, number>()

  constructor(readonly maxPerKey: number) {}

  /** Reserve a slot; returns a release function (idempotent), or null if at the limit. */
  tryAcquire(key: string): (() => void) | null {
    const current = this.active.get(key) ?? 0
    if (current >= this.maxPerKey) return null
    this.active.set(key, current + 1)

    let released = false
    return () => {
      if (released) return
      released = true
      const n = (this.active.get(key) ?? 1) - 1
      if (n <= 0) this.active.delete(key)
      else this.active.set(key, n)
    }
  }

  count(key: string): number {
    return this.active.get(key) ?? 0
  }
}

/** Bindings the Bun server passes to Hono's fetch so handlers can see the peer address. */
export interface ServerEnv {
  clientIp?: string
}

/**
 * Number of reverse proxies in front of the server that append to X-Forwarded-For.
 * TRUST_PROXY_HOPS=N trusts the last N entries; legacy TRUST_PROXY=1 means one hop.
 * N must match the deployed proxy chain exactly; surplus trusted hops can select
 * attacker-supplied entries. Missing/short chains are not trusted identities.
 */
export function trustedProxyHops(): number {
  if (process.env.TRUST_PROXY_HOPS !== undefined) {
    const hops = Number(process.env.TRUST_PROXY_HOPS)
    return Number.isSafeInteger(hops) && hops >= 0 ? hops : 0
  }
  return process.env.TRUST_PROXY === '1' ? 1 : 0
}

/**
 * Client IP, or null if it cannot be determined.
 * Without trusted proxies this is the socket peer address (X-Forwarded-For is ignored).
 * With N trusted hops, each proxy appends the address it received from, so the client
 * is the N-th entry from the right; entries further left are client-controlled.
 */
export function getClientIp(c: Context): string | null {
  const hops = trustedProxyHops()
  if (hops > 0) {
    const chain = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    const client = chain[chain.length - hops]
    return client ? normalizeClientIp(client) : null
  }
  const env = c.env as ServerEnv | undefined
  return env?.clientIp ? normalizeClientIp(env.clientIp) : null
}

/** IPv6 clients share a /64 budget; canonicalize mapped IPv4 as IPv4. */
export function normalizeClientIp(ip: string): string | null {
  const version = isIP(ip)
  if (version === 4) return ip
  if (version !== 6 || ip.includes('%')) return null
  const canonical = new URL('http://[' + ip + ']').hostname.slice(1, -1)
  const [left, right] = canonical.split('::')
  const head = left ? left.split(':') : []
  const tail = right ? right.split(':') : []
  const parts = right === undefined ? head : [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
  const words = parts.map(part => Number.parseInt(part, 16))
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    return [words[6]! >> 8, words[6]! & 255, words[7]! >> 8, words[7]! & 255].join('.')
  }
  return words.slice(0, 4).map(word => word.toString(16)).join(':') + '::/64'
}

export function tooManyRequests(c: Context, retryAfterSec: number, message = 'Too many requests, please try again later') {
  c.header('Retry-After', String(retryAfterSec))
  return c.json({
    error: {
      code: 'RATE_LIMITED',
      message,
      timestamp: new Date().toISOString()
    }
  }, 429)
}

export interface RateLimitRule {
  limiter: RateLimiter
  key: (c: Context) => string | null | Promise<string | null>
  /**
   * What to do when `key` returns null: 'skip' this limiter (another rule covers the
   * request) or 'reject' it. Never fall back to one shared bucket for all such requests.
   */
  onMissingKey?: 'skip' | 'reject'
}

/**
 * Middleware applying one or more limiters; each limiter is keyed by its own function.
 */
export function rateLimit(rules: RateLimitRule[], failuresOnly = false): MiddlewareHandler {
  return async (c, next) => {
    const refunds: Array<() => void> = []
    let admitted = false
    try {
      for (const rule of rules) {
        const key = await rule.key(c)
        if (key === null) {
          if (rule.onMissingKey === 'reject') {
            return c.json({
              error: {
                code: 'CLIENT_ADDRESS_UNKNOWN',
                message: 'Unable to determine the client address',
                timestamp: new Date().toISOString()
              }
            }, 400)
          }
          continue
        }
        const result = rule.limiter.hit(key)
        if (!result.allowed) return tooManyRequests(c, result.retryAfterSec)
        refunds.push(result.refund)
      }
      admitted = true
      await next()
    } finally {
      // Rejected reservations never count; success refunds only this request.
      if (!admitted || (failuresOnly && (c.res.status < 400 || c.res.status >= 500))) {
        for (const refund of refunds) refund()
      }
    }
  }
}

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// Shared limiter instances (tunable via env)
export const limiters = {
  // Login limiters count failed attempts only: middleware refunds their own reservations on success
  loginPerIp: new RateLimiter(envInt('RATE_LIMIT_LOGIN_PER_IP', 20), 15 * MINUTE),
  loginPerAccount: new RateLimiter(envInt('RATE_LIMIT_LOGIN_PER_ACCOUNT', 10), 15 * MINUTE),
  loginGlobalAccount: new RateLimiter(envInt('RATE_LIMIT_LOGIN_GLOBAL_ACCOUNT', 100), HOUR),
  registerPerIp: new RateLimiter(envInt('RATE_LIMIT_REGISTER_PER_IP', 5), HOUR),
  queryPerUser: new RateLimiter(envInt('RATE_LIMIT_QUERY_PER_USER', 30), HOUR),
  queryPerIp: new RateLimiter(envInt('RATE_LIMIT_QUERY_PER_IP', 60), HOUR)
}

export const runningQueryLimiter = new ConcurrencyLimiter(envInt('MAX_CONCURRENT_QUERIES_PER_USER', 2))

/** Normalized email from a JSON body (null if absent). */
export async function emailKey(c: Context): Promise<string | null> {
  try {
    const body = await c.req.json<{ email?: unknown }>()
    return typeof body.email === 'string' ? body.email.trim().toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * Per-account login key, scoped to the client IP so an attacker elsewhere cannot lock
 * the owner out. Without a known IP it falls back to the account alone.
 */
export async function loginAccountKey(c: Context): Promise<string | null> {
  const email = await emailKey(c)
  if (email === null) return null
  return `${email}|${getClientIp(c) ?? '?'}`
}
