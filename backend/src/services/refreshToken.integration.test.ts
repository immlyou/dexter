/**
 * Refresh-token rotation against a real PostgreSQL (row locks, READ COMMITTED snapshots,
 * rollback). Opt-in: set TEST_DATABASE_URL to a disposable database; it is migrated and
 * its users/refresh_tokens tables are written to.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrateWithLock } from '../db/migrateLocked'
import { eq } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'
import type { User } from '../db/schema'
import { createDrizzleRefreshTokenRepo, type RefreshTokenRepo } from './refreshToken.repo'
import { cleanupRefreshTokens, issueTokens, refreshAccessToken, verifyRefreshToken, logoutUser } from './auth.service'

const url = process.env.TEST_DATABASE_URL
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wraps a repo so inserts inside transactions are delayed, widening race windows. */
function withSlowInserts(base: RefreshTokenRepo, delayMs: number): RefreshTokenRepo {
  const wrap = (repo: RefreshTokenRepo): RefreshTokenRepo => ({
    ...repo,
    async insert(row) {
      await sleep(delayMs)
      return repo.insert(row)
    },
    transaction: (fn) => repo.transaction((tx) => fn(wrap(tx)))
  })
  return wrap(base)
}

describe.skipIf(!url)('refresh token rotation on PostgreSQL', () => {
  const database = drizzle(url ?? '', { schema })
  const repo = createDrizzleRefreshTokenRepo(database)
  let user: User

  const active = async () =>
    (await database.select().from(schema.refreshTokens).where(eq(schema.refreshTokens.userId, user.id)))
      .filter((r) => !r.isRevoked)

  beforeAll(async () => {
    const folder = fileURLToPath(new URL('../db/migrations', import.meta.url))
    // Concurrent startup must inspect migration state only after acquiring the lock.
    await Promise.all([migrateWithLock(database.$client, folder), migrateWithLock(database.$client, folder)])
  })

  afterAll(async () => {
    await database.$client.close()
  })

  beforeEach(async () => {
    const [row] = await database.insert(schema.users)
      .values({ email: `${crypto.randomUUID()}@test.local`, passwordHash: 'x' })
      .returning()
    user = row!
  })

  test('two concurrent refreshes of one token: one rotates, the replay revokes the successor', async () => {
    const { refreshToken } = await issueTokens(user, repo)
    const slow = withSlowInserts(repo, 50)
    const results = await Promise.allSettled([
      refreshAccessToken(refreshToken, slow),
      refreshAccessToken(refreshToken, slow)
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(String(rejected.reason)).toContain('REFRESH_TOKEN_REUSED')
    expect(await active()).toHaveLength(0)
  })

  // Pause at an exact transaction boundary, then observe the competitor waiting
  // in PostgreSQL or completing (the latter exposes a missing lock).
  function gateRepo(method: 'insert' | 'revokeAllForUser') {
    let enter!: () => void
    let resume!: () => void
    const entered = new Promise<void>(r => { enter = r })
    const paused = new Promise<void>(r => { resume = r })
    const gated: RefreshTokenRepo = {
      ...repo,
      transaction: fn => repo.transaction(tx => fn({
        ...tx,
        [method]: async (...args: unknown[]) => {
          if (method === 'insert') await tx.insert(args[0] as Parameters<RefreshTokenRepo['insert']>[0])
          else await tx.revokeAllForUser(args[0] as string)
          enter()
          await paused
        }
      }))
    }
    return { repo: gated, entered, resume }
  }

  async function blockedOrDone(operation: Promise<unknown>) {
    let done = false
    void operation.then(() => { done = true }, () => { done = true })
    const deadline = Date.now() + 2000
    while (!done && Date.now() < deadline) {
      const rows = await database.$client`
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND pid <> pg_backend_pid()
      `
      if (rows.length) return
      await sleep(5)
    }
    if (!done) throw new Error('Competing transaction neither blocked nor completed')
  }

  for (const issuance of ['login', 'rotation'] as const) {
    test(issuance + ' commits before replay: its specific successor must be revoked', async () => {
      const original = await issueTokens(user, repo)
      const current = await refreshAccessToken(original.refreshToken, repo)
      const gate = gateRepo('insert')
      const issuing = issuance === 'login'
        ? issueTokens(user, gate.repo)
        : refreshAccessToken(current.refreshToken, gate.repo)
      await gate.entered
      const replay = Promise.allSettled([refreshAccessToken(original.refreshToken, repo)])
      try { await blockedOrDone(replay) } finally { gate.resume() }
      const fresh = await issuing
      const [result] = await replay
      expect(result!.status).toBe('rejected')
      expect(String((result as PromiseRejectedResult).reason)).toContain('REFRESH_TOKEN_REUSED')
      const successor = await repo.findByJti(verifyRefreshToken(fresh.refreshToken).jti)
      expect(successor?.isRevoked).toBe(true)
      expect(await active()).toHaveLength(0)
    })
  }

  test('replay commits before login: exactly the later login token survives', async () => {
    const original = await issueTokens(user, repo)
    await refreshAccessToken(original.refreshToken, repo)
    const gate = gateRepo('revokeAllForUser')
    const replay = Promise.allSettled([refreshAccessToken(original.refreshToken, gate.repo)])
    await gate.entered
    const login = issueTokens(user, repo)
    try { await blockedOrDone(login) } finally { gate.resume() }
    const fresh = await login
    const [result] = await replay
    expect(String((result as PromiseRejectedResult).reason)).toContain('REFRESH_TOKEN_REUSED')
    expect((await active()).map(row => row.jti)).toEqual([verifyRefreshToken(fresh.refreshToken).jti])
  })

  test('logout racing a rotation revokes its specific successor', async () => {
    const original = await issueTokens(user, repo)
    const gate = gateRepo('insert')
    const rotation = refreshAccessToken(original.refreshToken, gate.repo)
    await gate.entered
    const logout = logoutUser(original.refreshToken, repo)
    try { await blockedOrDone(logout) } finally { gate.resume() }
    const fresh = await rotation
    await logout
    expect((await repo.findByJti(verifyRefreshToken(fresh.refreshToken).jti))?.isRevoked).toBe(true)
    expect(await active()).toHaveLength(0)
  })

  test('a failure after revoking rolls the rotation back', async () => {
    const { refreshToken } = await issueTokens(user, repo)
    const failing: RefreshTokenRepo = {
      ...repo,
      transaction: (fn) => repo.transaction((tx) => fn({
        ...tx,
        async insert() {
          throw new Error('boom')
        }
      }))
    }
    await expect(refreshAccessToken(refreshToken, failing)).rejects.toThrow('boom')
    expect(await active()).toHaveLength(1)
    await refreshAccessToken(refreshToken, repo)
  })

  test('cleanup preserves unexpired replay evidence beyond the former seven-day retention', async () => {
    const original = await issueTokens(user, repo)
    const successor = await refreshAccessToken(original.refreshToken, repo)
    await database.update(schema.refreshTokens).set({ revokedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000) })
      .where(eq(schema.refreshTokens.jti, verifyRefreshToken(original.refreshToken).jti))
    await cleanupRefreshTokens(repo)
    expect(await repo.findByJti(verifyRefreshToken(original.refreshToken).jti)).toBeDefined()
    await expect(refreshAccessToken(original.refreshToken, repo)).rejects.toThrow('REFRESH_TOKEN_REUSED')
    expect((await repo.findByJti(verifyRefreshToken(successor.refreshToken).jti))?.isRevoked).toBe(true)
  })

  test('cleanup deletes expired rows', async () => {
    await issueTokens(user, repo)
    await database.insert(schema.refreshTokens).values({
      userId: user.id, jti: crypto.randomUUID(), tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() - 1000)
    })
    expect(await cleanupRefreshTokens(repo)).toBeGreaterThanOrEqual(1)
    expect(await active()).toHaveLength(1)
  })
})
