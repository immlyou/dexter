import { describe, test, expect, beforeEach } from 'bun:test'
import jwt from 'jsonwebtoken'
import { Hono } from 'hono'
import { getAuthSecrets } from '../config/secrets'
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  digestToken,
  issueTokens,
  refreshAccessToken,
  logoutUser,
  REFRESH_AUDIENCE
} from './auth.service'
import type { RefreshTokenRepo } from './refreshToken.repo'
import type { RefreshToken, User } from '../db/schema'
import { requireAuth } from '../middleware/auth'

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: crypto.randomUUID(),
    email: 'user@example.com',
    passwordHash: 'x',
    name: null,
    plan: 'free',
    preferences: {},
    emailVerified: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  }
}

/** In-memory stand-in for the Drizzle repo, mirroring its conditional-update semantics. */
class MemoryRepo implements RefreshTokenRepo {
  rows: RefreshToken[] = []
  users = new Map<string, User>()

  async insert(row: { userId: string; jti: string; tokenHash: string; expiresAt: Date }) {
    if (this.rows.some((r) => r.jti === row.jti || r.tokenHash === row.tokenHash)) throw new Error('unique violation')
    this.rows.push({ id: crypto.randomUUID(), isRevoked: false, createdAt: new Date(), ...row })
  }
  async findByJti(jti: string) {
    return this.rows.find((r) => r.jti === jti)
  }
  async revokeActive(jti: string, tokenHash: string) {
    const row = this.rows.find((r) => r.jti === jti && r.tokenHash === tokenHash && !r.isRevoked)
    if (!row) return undefined
    row.isRevoked = true
    return { ...row }
  }
  async revokeAllForUser(userId: string) {
    for (const r of this.rows) if (r.userId === userId) r.isRevoked = true
  }
  async getUser(userId: string) {
    return this.users.get(userId)
  }
  async transaction<T>(fn: (repo: RefreshTokenRepo) => Promise<T>): Promise<T> {
    return fn(this)
  }
  active(userId: string) {
    return this.rows.filter((r) => r.userId === userId && !r.isRevoked)
  }
}

describe('access/refresh token separation', () => {
  const payload = { userId: 'u1', email: 'a@b.c', plan: 'free' }

  test('access token verifies as access with typ claim', () => {
    const claims = verifyAccessToken(generateAccessToken(payload))
    expect(claims.typ).toBe('access')
    expect(claims.userId).toBe('u1')
  })

  test('refresh token is rejected as an access token', () => {
    const { token } = generateRefreshToken('u1')
    expect(() => verifyAccessToken(token)).toThrow('TOKEN_INVALID')
  })

  test('access token is rejected as a refresh token', () => {
    expect(() => verifyRefreshToken(generateAccessToken(payload))).toThrow('TOKEN_INVALID')
  })

  test('typ is enforced even if a token is signed with the right secret and audience', () => {
    const forged = jwt.sign({ userId: 'u1', typ: 'access' }, getAuthSecrets().refreshSecret, {
      issuer: 'dexter-api', audience: REFRESH_AUDIENCE, jwtid: 'j1', expiresIn: '1h'
    })
    expect(() => verifyRefreshToken(forged)).toThrow('TOKEN_INVALID')
  })

  test('alg=none tokens are rejected', () => {
    const unsigned = jwt.sign({ ...payload, typ: 'access' }, '', { algorithm: 'none', issuer: 'dexter-api', audience: 'dexter-client' } as jwt.SignOptions)
    expect(() => verifyAccessToken(unsigned)).toThrow('TOKEN_INVALID')
  })

  test('expired access token reports TOKEN_EXPIRED', () => {
    const expired = jwt.sign({ ...payload, typ: 'access', exp: Math.floor(Date.now() / 1000) - 10 }, getAuthSecrets().accessSecret, {
      issuer: 'dexter-api', audience: 'dexter-client'
    })
    expect(() => verifyAccessToken(expired)).toThrow('TOKEN_EXPIRED')
  })

  test('each refresh token gets a unique random jti', () => {
    const a = generateRefreshToken('u1')
    const b = generateRefreshToken('u1')
    expect(a.jti).not.toBe(b.jti)
    expect(verifyRefreshToken(a.token).jti).toBe(a.jti)
    expect(a.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  test('requireAuth rejects a refresh token before touching the database', async () => {
    const app = new Hono()
    app.get('/me', requireAuth, (c) => c.text('ok'))
    const res = await app.request('/me', { headers: { Authorization: `Bearer ${generateRefreshToken('u1').token}` } })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('AUTH_INVALID_TOKEN')
  })
})

describe('refresh token storage and rotation', () => {
  let repo: MemoryRepo
  let user: User

  beforeEach(() => {
    repo = new MemoryRepo()
    user = makeUser()
    repo.users.set(user.id, user)
  })

  test('stores the SHA-256 digest of the full token keyed by jti', async () => {
    const { refreshToken } = await issueTokens(user, repo)
    const { jti } = verifyRefreshToken(refreshToken)
    const row = await repo.findByJti(jti)
    expect(row?.tokenHash).toBe(digestToken(refreshToken))
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.tokenHash).not.toContain(refreshToken)
  })

  test('rotation revokes the old token and issues a new working pair', async () => {
    const first = await issueTokens(user, repo)
    const second = await refreshAccessToken(first.refreshToken, repo)

    expect(second.refreshToken).not.toBe(first.refreshToken)
    expect(verifyAccessToken(second.accessToken).userId).toBe(user.id)
    expect(repo.active(user.id).map((r) => r.jti)).toEqual([verifyRefreshToken(second.refreshToken).jti])
  })

  test('reusing a rotated token revokes every token of the user', async () => {
    const first = await issueTokens(user, repo)
    const second = await refreshAccessToken(first.refreshToken, repo)
    await issueTokens(user, repo) // another device

    await expect(refreshAccessToken(first.refreshToken, repo)).rejects.toThrow('REFRESH_TOKEN_REUSED')
    expect(repo.active(user.id)).toHaveLength(0)
    // The legitimately rotated token is now dead too
    await expect(refreshAccessToken(second.refreshToken, repo)).rejects.toThrow('REFRESH_TOKEN_REUSED')
  })

  test('concurrent refreshes with the same token: exactly one succeeds', async () => {
    const { refreshToken } = await issueTokens(user, repo)
    const results = await Promise.allSettled([
      refreshAccessToken(refreshToken, repo),
      refreshAccessToken(refreshToken, repo)
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  test('unknown jti (e.g. deleted row) is invalid, not reuse', async () => {
    const { token } = generateRefreshToken(user.id)
    await expect(refreshAccessToken(token, repo)).rejects.toThrow('INVALID_REFRESH_TOKEN')
  })

  test('inactive users cannot refresh and lose all sessions', async () => {
    const { refreshToken } = await issueTokens(user, repo)
    repo.users.set(user.id, { ...user, isActive: false })
    await expect(refreshAccessToken(refreshToken, repo)).rejects.toThrow('USER_INACTIVE')
    expect(repo.active(user.id)).toHaveLength(0)
  })

  test('new access token reflects the current plan from the database', async () => {
    const { refreshToken } = await issueTokens(user, repo)
    repo.users.set(user.id, { ...user, plan: 'pro' })
    const rotated = await refreshAccessToken(refreshToken, repo)
    expect(verifyAccessToken(rotated.accessToken).plan).toBe('pro')
  })

  test('access tokens cannot be used to refresh', async () => {
    const { accessToken } = await issueTokens(user, repo)
    await expect(refreshAccessToken(accessToken, repo)).rejects.toThrow('TOKEN_INVALID')
  })

  test('logout revokes only the presented token', async () => {
    const a = await issueTokens(user, repo)
    await issueTokens(user, repo)
    await logoutUser(a.refreshToken, repo)
    expect(repo.active(user.id)).toHaveLength(1)
    expect((await repo.findByJti(verifyRefreshToken(a.refreshToken).jti))?.isRevoked).toBe(true)
  })
})
