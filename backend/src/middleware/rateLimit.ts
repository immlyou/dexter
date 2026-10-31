import type { Context, MiddlewareHandler } from 'hono'

const DEFAULT_MAX_KEYS = 50_000
// Expired windows are swept at least this often, whatever the window length
const MAX_SWEEP_INTERVAL_MS = 60_000

/**
 * In-memory fixed-window rate limiter. Single-process only: state is lost on restart
 * and not shared between replicas (use Redis or similar when scaling out).
 * The key map is bounded: expired windows are swept periodically and, when `maxKeys`
 * is reached, the oldest window is evicted (Map preserves insertion order).
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
  hit(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = this.now()
    this.sweep(now)

    let entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      // Re-insert so insertion order tracks window start (oldest first)
      this.hits.delete(key)
      this.evictIfFull(now)
      entry = { count: 0, resetAt: now + this.windowMs }
      this.hits.set(key, entry)
    }
    entry.count++
    return {
      allowed: entry.count <= this.max,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    }
  }

  /** Take back one hit (e.g. an attempt that turned out to succeed). */
  undo(key: string): void {
    const entry = this.hits.get(key)
    if (entry && entry.count > 0) entry.count--
  }

  /** Forget a key entirely (e.g. after a successful login). */
  clear(key: string): void {
    this.hits.delete(key)
  }

  get size(): number {
    return this.hits.size
  }

  reset(): void {
    this.hits.clear()
  }

  private evictIfFull(now: number): void {
    if (this.hits.size < this.maxKeys) return
    this.sweep(now, true)
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value
      if (oldest === undefined) break
      this.hits.delete(oldest)
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
 */
export function trustedProxyHops(): number {
  const hops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '', 10)
  if (Number.isFinite(hops) && hops > 0) return hops
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
    if (client) return client
  }
  const env = c.env as ServerEnv | undefined
  return env?.clientIp || null
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
export function rateLimit(rules: RateLimitRule[]): MiddlewareHandler {
  return async (c, next) => {
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
    }
    await next()
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
  // Login limiters count failed attempts only: the route undoes/clears them on success
  loginPerIp: new RateLimiter(envInt('RATE_LIMIT_LOGIN_PER_IP', 20), 15 * MINUTE),
  loginPerAccount: new RateLimiter(envInt('RATE_LIMIT_LOGIN_PER_ACCOUNT', 10), 15 * MINUTE),
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

/** Refund a successful login: it must not count towards the failure limits. */
export async function recordLoginSuccess(
  c: Context,
  perIp: RateLimiter = limiters.loginPerIp,
  perAccount: RateLimiter = limiters.loginPerAccount
): Promise<void> {
  const ip = getClientIp(c)
  if (ip) perIp.undo(ip)
  const accountKey = await loginAccountKey(c)
  if (accountKey) perAccount.clear(accountKey)
}
