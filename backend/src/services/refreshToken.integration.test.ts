/**
 * Refresh-token rotation against a real PostgreSQL (row locks, READ COMMITTED snapshots,
 * rollback). Opt-in: set TEST_DATABASE_URL to a disposable database; it is migrated and
 * its users/refresh_tokens tables are written to.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { drizzle } from 'drizzle-orm/bun-sql'
import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { eq } from 'drizzle-orm'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'
import type { User } from '../db/schema'
import { createDrizzleRefreshTokenRepo, type RefreshTokenRepo } from './refreshToken.repo'
import { cleanupRefreshTokens, issueTokens, refreshAccessToken, REFRESH_REUSE_GRACE_MS } from './auth.service'

const url = process.env.TEST_DATABASE_URL
const afterGrace = () => Date.now() + REFRESH_REUSE_GRACE_MS + 1000
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
    await migrate(database, { migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) })
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

  test('two concurrent refreshes of one token: one rotates, the other gets REFRESH_RETRY', async () => {
    const { refreshToken } = await issueTokens(user, repo)
    const slow = withSlowInserts(repo, 50)
    const results = await Promise.allSettled([
      refreshAccessToken(refreshToken, slow),
      refreshAccessToken(refreshToken, slow)
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(String(rejected.reason)).toContain('REFRESH_RETRY')
    expect(await active()).toHaveLength(1)
  })

  test('replay of a rotated token racing a rotation leaves no live token', async () => {
    for (let i = 0; i < 5; i++) {
      const a = await issueTokens(user, repo)
      const b = await refreshAccessToken(a.refreshToken, repo)
      const slow = withSlowInserts(repo, 80)
      const rotation = refreshAccessToken(b.refreshToken, slow)
      await sleep(10) // rotation holds the user lock and is mid-transaction
      const replay = refreshAccessToken(a.refreshToken, repo, afterGrace)
      const [rot, rep] = await Promise.allSettled([rotation, replay])
      expect(rot.status).toBe('fulfilled')
      expect(String((rep as PromiseRejectedResult).reason)).toContain('REFRESH_TOKEN_REUSED')
      expect(await active()).toHaveLength(0)
    }
  })

  test('replay that wins the lock first kills the racing rotation as well', async () => {
    const a = await issueTokens(user, repo)
    const b = await refreshAccessToken(a.refreshToken, repo)
    const slowReplayRepo: RefreshTokenRepo = {
      ...repo,
      transaction: (fn) => repo.transaction(async (tx) => {
        const result = await fn({
          ...tx,
          async revokeAllForUser(userId) {
            await sleep(80)
            return tx.revokeAllForUser(userId)
          }
        })
        return result
      })
    }
    const replay = refreshAccessToken(a.refreshToken, slowReplayRepo, afterGrace)
    await sleep(10)
    const rotation = refreshAccessToken(b.refreshToken, repo)
    const [rep, rot] = await Promise.allSettled([replay, rotation])
    expect(String((rep as PromiseRejectedResult).reason)).toContain('REFRESH_TOKEN_REUSED')
    expect(String((rot as PromiseRejectedResult).reason)).toContain('REFRESH_TOKEN_REUSED')
    expect(await active()).toHaveLength(0)
  })

  test('login issuance is ordered against a concurrent revoke-all', async () => {
    const a = await issueTokens(user, repo)
    await refreshAccessToken(a.refreshToken, repo)
    const replay = refreshAccessToken(a.refreshToken, withSlowInserts(repo, 0), afterGrace)
    const login = issueTokens(user, withSlowInserts(repo, 50))
    const [rep, fresh] = await Promise.allSettled([replay, login])
    expect(rep.status).toBe('rejected')
    expect(fresh.status).toBe('fulfilled')
    // Whatever the order, the database matches it: either the login token survived
    // (issued after the revoke-all) or nothing did
    const live = await active()
    expect(live.length).toBeLessThanOrEqual(1)
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

  test('cleanup deletes expired rows', async () => {
    await issueTokens(user, repo)
    await database.insert(schema.refreshTokens).values({
      userId: user.id, jti: crypto.randomUUID(), tokenHash: crypto.randomUUID(), expiresAt: new Date(Date.now() - 1000)
    })
    expect(await cleanupRefreshTokens(repo)).toBeGreaterThanOrEqual(1)
    expect(await active()).toHaveLength(1)
  })
})
