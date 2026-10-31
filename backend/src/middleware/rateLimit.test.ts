import { describe, test, expect } from 'bun:test'
import { Hono } from 'hono'
import { RateLimiter, ConcurrencyLimiter, rateLimit, getClientIp, emailKey, loginAccountKey, normalizeClientIp } from './rateLimit'

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

  test('per-IP key uses the socket address and ignores X-Forwarded-For unless proxies are trusted', async () => {
    const limiter = new RateLimiter(1, 60_000)
    const app = new Hono()
    app.get('/', rateLimit([{ limiter, key: getClientIp }]), (c) => c.text('ok'))
    const req = (xff: string) => app.request('/', { headers: { 'x-forwarded-for': xff } }, { clientIp: '203.0.113.9' })

    expect((await req('1.1.1.1')).status).toBe(200)
    // Spoofed header does not grant a fresh bucket
    expect((await req('2.2.2.2')).status).toBe(429)
  })
})

describe('getClientIp with trusted proxies', () => {
  async function ipFor(xff: string | undefined, env: Record<string, string>, clientIp: string | null = '10.0.0.2') {
    const saved = { hops: process.env.TRUST_PROXY_HOPS, legacy: process.env.TRUST_PROXY }
    delete process.env.TRUST_PROXY_HOPS
    delete process.env.TRUST_PROXY
    Object.assign(process.env, env)
    try {
      const app = new Hono()
      let seen: string | null = 'unset'
      app.get('/', (c) => { seen = getClientIp(c); return c.text('ok') })
      await app.request('/', { headers: xff === undefined ? {} : { 'x-forwarded-for': xff } }, { clientIp: clientIp ?? undefined })
      return seen
    } finally {
      if (saved.hops === undefined) delete process.env.TRUST_PROXY_HOPS; else process.env.TRUST_PROXY_HOPS = saved.hops
      if (saved.legacy === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = saved.legacy
    }
  }

  test('one hop takes the rightmost entry, not the client-controlled leftmost', async () => {
    expect(await ipFor('6.6.6.6, 198.51.100.7', { TRUST_PROXY_HOPS: '1' })).toBe('198.51.100.7')
  })

  test('explicit zero or invalid hops override legacy trust', async () => {
    for (const hops of ['0', '-1', '1junk']) {
      expect(await ipFor('6.6.6.6', { TRUST_PROXY_HOPS: hops, TRUST_PROXY: '1' })).toBe('10.0.0.2')
    }
  })

  test('legacy TRUST_PROXY=1 means one hop', async () => {
    expect(await ipFor('6.6.6.6, 198.51.100.7', { TRUST_PROXY: '1' })).toBe('198.51.100.7')
  })

  test('N hops take the N-th entry from the right', async () => {
    expect(await ipFor('6.6.6.6, 198.51.100.7, 10.0.0.5', { TRUST_PROXY_HOPS: '2' })).toBe('198.51.100.7')
  })

  test('a chain shorter than the hop count fails closed', async () => {
    expect(await ipFor('198.51.100.7', { TRUST_PROXY_HOPS: '2' })).toBeNull()
    expect(await ipFor(undefined, { TRUST_PROXY_HOPS: '1' })).toBeNull()
  })

  test('no proxy trust ignores the header entirely', async () => {
    expect(await ipFor('6.6.6.6', {})).toBe('10.0.0.2')
  })

  test('unknown address is null, never a shared placeholder', async () => {
    expect(await ipFor(undefined, {}, null)).toBeNull()
  })
})

describe('missing client address', () => {
  test('requests without an IP do not share one bucket', async () => {
    const limiter = new RateLimiter(1, 60_000)
    const app = new Hono()
    app.get('/', rateLimit([{ limiter, key: getClientIp }]), (c) => c.text('ok'))
    for (let i = 0; i < 3; i++) expect((await app.request('/')).status).toBe(200)
    expect(limiter.size).toBe(0)
  })

  test("onMissingKey 'reject' refuses the request", async () => {
    const app = new Hono()
    app.get('/', rateLimit([{ limiter: new RateLimiter(5, 1000), key: getClientIp, onMissingKey: 'reject' }]), (c) => c.text('ok'))
    const res = await app.request('/')
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('CLIENT_ADDRESS_UNKNOWN')
  })
})

describe('login failure limiting', () => {
  function loginApp(perIp: RateLimiter, perAccount: RateLimiter, password: string) {
    const app = new Hono()
    app.post('/login', rateLimit([
      { limiter: perIp, key: getClientIp },
      { limiter: perAccount, key: loginAccountKey }
    ], true), async (c) => {
      const body = await c.req.json<{ password: string }>()
      if (body.password !== password) return c.json({ error: 'bad' }, 401)
      return c.json({ ok: true })
    })
    return app
  }
  const attempt = async (app: Hono, ip: string, password: string, email = 'victim@x.com') =>
    (await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    }, { clientIp: ip })).status

  test('failures from another IP cannot lock the account owner out', async () => {
    const app = loginApp(new RateLimiter(100, 60_000), new RateLimiter(3, 60_000), 'right')
    for (let i = 0; i < 5; i++) await attempt(app, '6.6.6.6', 'wrong')
    expect(await attempt(app, '6.6.6.6', 'wrong')).toBe(429)
    expect(await attempt(app, '198.51.100.7', 'right')).toBe(200)
  })

  test('successful logins do not count; failures do', async () => {
    const app = loginApp(new RateLimiter(2, 60_000), new RateLimiter(2, 60_000), 'right')
    for (let i = 0; i < 5; i++) expect(await attempt(app, '198.51.100.7', 'right')).toBe(200)
    expect(await attempt(app, '198.51.100.7', 'wrong')).toBe(401)
    expect(await attempt(app, '198.51.100.7', 'wrong')).toBe(401)
    expect(await attempt(app, '198.51.100.7', 'wrong')).toBe(429)
  })

  test('a success refunds itself without resetting earlier failures', async () => {
    const perAccount = new RateLimiter(2, 60_000)
    const app = loginApp(new RateLimiter(100, 60_000), perAccount, 'right')
    await attempt(app, '198.51.100.7', 'wrong')
    expect(await attempt(app, '198.51.100.7', 'right')).toBe(200)
    expect(await attempt(app, '198.51.100.7', 'wrong')).toBe(401)
    expect(await attempt(app, '198.51.100.7', 'wrong')).toBe(429)
  })
})

describe('RateLimiter memory bounds', () => {
  test('a full map still admits new keys and keeps the busiest counters', () => {
    const limiter = new RateLimiter(3, 60_000, () => 0, 3)
    for (let i = 0; i < 3; i++) limiter.hit('victim')
    limiter.hit('a')
    limiter.hit('b')
    // Flood of fresh keys (e.g. random emails): each new client is still admitted...
    for (let i = 0; i < 100; i++) expect(limiter.hit(`flood-${i}`).allowed).toBe(true)
    expect(limiter.size).toBe(3)
    // ...and the counter under attack is never displaced by low-count entries
    expect(limiter.hit('victim').allowed).toBe(false)
  })

  test('evicts the oldest of the lowest-count entries', () => {
    const limiter = new RateLimiter(5, 60_000, () => 0, 3)
    limiter.hit('a'); limiter.hit('a')
    limiter.hit('b')
    limiter.hit('c')
    limiter.hit('d') // evicts b (count 1, older than c)
    limiter.hit('a'); limiter.hit('a'); limiter.hit('a')
    expect(limiter.hit('a').allowed).toBe(false) // a kept its 5 hits
    expect(limiter.hit('c').allowed).toBe(true)
    expect(limiter.size).toBe(3)
  })

  test('a full map evicts a batch of lowest-count entries, then admits keys without scanning', () => {
    const limiter = new RateLimiter(5, 60_000, () => 0, 200)
    for (let i = 0; i < 200; i++) { limiter.hit(`k${i}`); limiter.hit(`k${i}`) }
    limiter.hit('k199') // k199 now has 3 hits
    limiter.hit('new-0') // evicts k0 and k1 (1% of 200, oldest at the minimum count)
    expect(limiter.size).toBe(199)
    limiter.hit('new-1') // room left: no eviction
    expect(limiter.size).toBe(200)
    for (let i = 0; i < 3; i++) expect(limiter.hit('k2').allowed).toBe(true) // k2 kept its 2 hits
    expect(limiter.hit('k2').allowed).toBe(false)
  })

  test('expired windows are swept within a minute even for long windows', () => {
    let now = 0
    const limiter = new RateLimiter(1, 3_600_000, () => now)
    limiter.hit('a')
    now = 3_600_001
    limiter.hit('b') // triggers sweep
    expect(limiter.size).toBe(1)
  })

  test('a flood of unique keys stays bounded', () => {
    const limiter = new RateLimiter(5, 60_000, () => 0, 1000)
    for (let i = 0; i < 20_000; i++) limiter.hit(`ip-${i}`)
    expect(limiter.size).toBeLessThanOrEqual(1000)
  })
})


describe('login reservation regressions', () => {
  test('concurrent successes and denials leave no false failures', async () => {
    const perIp = new RateLimiter(2, 60_000)
    const app = new Hono()
    let resume!: () => void
    let entered = 0
    let both!: () => void
    let ready: Promise<void>
    let pause: Promise<void>
    app.post('/', rateLimit([{ limiter: perIp, key: getClientIp }], true), async c => {
      entered++
      if (entered === 2) both()
      await pause
      return c.text('ok')
    })
    const request = () => app.request('/', { method: 'POST' }, { clientIp: '192.0.2.1' })
    for (let round = 0; round < 3; round++) {
      entered = 0
      ready = new Promise<void>(r => { both = r })
      pause = new Promise<void>(r => { resume = r })
      const first = request()
      const second = request()
      await ready
      expect((await request()).status).toBe(429)
      resume()
      expect((await first).status).toBe(200)
      expect((await second).status).toBe(200)
    }
  })

  test('late refunds cannot erase a newer window', () => {
    let now = 0
    const limiter = new RateLimiter(1, 100, () => now)
    const old = limiter.hit('k')
    now = 101
    limiter.hit('k')
    old.refund()
    old.refund()
    expect(limiter.hit('k').allowed).toBe(false)
  })

  test('denial by a later rule refunds earlier reservations', async () => {
    const ip = new RateLimiter(2, 60000)
    const account = new RateLimiter(1, 60000)
    const app = new Hono()
    app.post('/', rateLimit([{ limiter: ip, key: getClientIp }, { limiter: account, key: emailKey }], true), c => c.text('bad', 401))
    const request = (email: string) => app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, { clientIp: '192.0.2.1' })
    expect((await request('a@x.com')).status).toBe(401)
    for (let i = 0; i < 5; i++) expect((await request('a@x.com')).status).toBe(429)
    expect((await request('b@x.com')).status).toBe(401)
  })

  test('global account cap spans source addresses', async () => {
    const app = new Hono()
    app.post('/', rateLimit([{ limiter: new RateLimiter(3, 60000), key: emailKey }], true), c => c.text('bad', 401))
    for (let i = 1; i <= 4; i++) {
      const res = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'Victim@x.com' }) }, { clientIp: '192.0.2.' + i })
      expect(res.status).toBe(i <= 3 ? 401 : 429)
    }
  })

  test('IPv6 /64 and IPv4-mapped addresses have canonical budgets', () => {
    expect(normalizeClientIp('2001:db8:abcd:1234::1')).toBe(normalizeClientIp('2001:0db8:abcd:1234:ffff::2'))
    expect(normalizeClientIp('2001:db8:abcd:1235::1')).not.toBe(normalizeClientIp('2001:db8:abcd:1234::1'))
    expect(normalizeClientIp('::ffff:192.0.2.1')).toBe('192.0.2.1')
    expect(normalizeClientIp('spoof')).toBeNull()
  })
})
