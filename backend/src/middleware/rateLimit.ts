import type { Context, MiddlewareHandler } from 'hono'

/**
 * In-memory fixed-window rate limiter. Single-process only: state is lost on restart
 * and not shared between replicas (use Redis or similar when scaling out).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()
  private lastSweep = 0

  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Record a hit for `key`; returns whether it is allowed and when to retry. */
  hit(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = this.now()
    this.sweep(now)

    let entry = this.hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs }
      this.hits.set(key, entry)
    }
    entry.count++
    return {
      allowed: entry.count <= this.max,
      retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    }
  }

  reset(): void {
    this.hits.clear()
  }

  // Drop expired windows at most once per window so the map cannot grow unbounded
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return
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
 * Client IP: the socket peer address, or the first X-Forwarded-For hop when
 * TRUST_PROXY=1 (only safe behind a proxy that overwrites that header).
 */
export function getClientIp(c: Context): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  const env = c.env as ServerEnv | undefined
  return env?.clientIp || 'unknown'
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

/**
 * Middleware applying one or more limiters; each limiter is keyed by its own function.
 * A key function returning null skips that limiter for the request.
 */
export function rateLimit(rules: Array<{ limiter: RateLimiter; key: (c: Context) => string | null | Promise<string | null> }>): MiddlewareHandler {
  return async (c, next) => {
    for (const rule of rules) {
      const key = await rule.key(c)
      if (key === null) continue
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
  loginPerIp: new RateLimiter(envInt('RATE_LIMIT_LOGIN_PER_IP', 20), 15 * MINUTE),
  loginPerAccount: new RateLimiter(envInt('RATE_LIMIT_LOGIN_PER_ACCOUNT', 10), 15 * MINUTE),
  registerPerIp: new RateLimiter(envInt('RATE_LIMIT_REGISTER_PER_IP', 5), HOUR),
  queryPerUser: new RateLimiter(envInt('RATE_LIMIT_QUERY_PER_USER', 30), HOUR),
  queryPerIp: new RateLimiter(envInt('RATE_LIMIT_QUERY_PER_IP', 60), HOUR)
}

export const runningQueryLimiter = new ConcurrencyLimiter(envInt('MAX_CONCURRENT_QUERIES_PER_USER', 2))

/** Normalized email from a JSON body, for per-account limits (null if absent). */
export async function emailKey(c: Context): Promise<string | null> {
  try {
    const body = await c.req.json<{ email?: unknown }>()
    return typeof body.email === 'string' ? body.email.trim().toLowerCase() : null
  } catch {
    return null
  }
}
