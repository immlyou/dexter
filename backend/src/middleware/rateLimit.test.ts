import { describe, test, expect } from 'bun:test'
import { Hono } from 'hono'
import { RateLimiter, ConcurrencyLimiter, rateLimit, getClientIp, emailKey } from './rateLimit'

describe('RateLimiter', () => {
  test('allows up to max hits per window, then blocks with Retry-After', () => {
    let now = 0
    const limiter = new RateLimiter(3, 60_000, () => now)
    expect([1, 2, 3].map(() => limiter.hit('k').allowed)).toEqual([true, true, true])
    const blocked = limiter.hit('k')
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBe(60)
    now = 30_000
    expect(limiter.hit('k').retryAfterSec).toBe(30)
  })

  test('keys are independent', () => {
    const limiter = new RateLimiter(1, 1000, () => 0)
    expect(limiter.hit('a').allowed).toBe(true)
    expect(limiter.hit('b').allowed).toBe(true)
    expect(limiter.hit('a').allowed).toBe(false)
  })

  test('window resets after expiry', () => {
    let now = 0
    const limiter = new RateLimiter(1, 1000, () => now)
    limiter.hit('k')
    expect(limiter.hit('k').allowed).toBe(false)
    now = 1000
    expect(limiter.hit('k').allowed).toBe(true)
  })
})

describe('ConcurrencyLimiter', () => {
  test('caps concurrent slots per key and frees them on release', () => {
    const limiter = new ConcurrencyLimiter(2)
    const r1 = limiter.tryAcquire('u')
    const r2 = limiter.tryAcquire('u')
    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()
    expect(limiter.tryAcquire('u')).toBeNull()
    expect(limiter.tryAcquire('other')).not.toBeNull()

    r1!()
    expect(limiter.count('u')).toBe(1)
    expect(limiter.tryAcquire('u')).not.toBeNull()
  })

  test('release is idempotent', () => {
    const limiter = new ConcurrencyLimiter(1)
    const release = limiter.tryAcquire('u')!
    release()
    release()
    expect(limiter.count('u')).toBe(0)
    const again = limiter.tryAcquire('u')
    expect(again).not.toBeNull()
    expect(limiter.tryAcquire('u')).toBeNull()
  })
})

describe('rateLimit middleware', () => {
  function makeApp(limiter: RateLimiter) {
    const app = new Hono()
    app.post('/login', rateLimit([{ limiter, key: emailKey }]), async (c) => {
      const body = await c.req.json<{ email: string }>()
      return c.json({ email: body.email })
    })
    return app
  }

  const post = (app: Hono, email: string) =>
    app.request('/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })

  test('returns 429 with Retry-After once the limit is exceeded, keyed per account', async () => {
    const app = makeApp(new RateLimiter(2, 60_000))
    expect((await post(app, 'A@x.com')).status).toBe(200)
    expect((await post(app, 'a@x.com ')).status).toBe(200)
    const res = await post(app, 'a@X.com')
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect((await res.json()).error.code).toBe('RATE_LIMITED')
    expect((await post(app, 'b@x.com')).status).toBe(200)
  })

  test('handler can still read the JSON body after the limiter parsed it', async () => {
    const res = await post(makeApp(new RateLimiter(5, 1000)), 'c@x.com')
    expect(await res.json()).toEqual({ email: 'c@x.com' })
  })

  test('per-IP key uses the socket address and ignores X-Forwarded-For unless TRUST_PROXY=1', async () => {
    const limiter = new RateLimiter(1, 60_000)
    const app = new Hono()
    app.get('/', rateLimit([{ limiter, key: getClientIp }]), (c) => c.text('ok'))
    const req = (xff: string) => app.request('/', { headers: { 'x-forwarded-for': xff } }, { clientIp: '203.0.113.9' })

    expect((await req('1.1.1.1')).status).toBe(200)
    // Spoofed header does not grant a fresh bucket
    expect((await req('2.2.2.2')).status).toBe(429)

    process.env.TRUST_PROXY = '1'
    try {
      expect((await req('3.3.3.3')).status).toBe(200)
    } finally {
      delete process.env.TRUST_PROXY
    }
  })
})
