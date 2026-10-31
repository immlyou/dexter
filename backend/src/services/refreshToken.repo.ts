import { and, eq, isNotNull, lt, or } from 'drizzle-orm'
import { db } from '../db/client'
import { refreshTokens, users, type RefreshToken, type User } from '../db/schema'

/**
 * Persistence operations needed for refresh-token issuance and rotation.
 * Abstracted so the rotation logic can be unit-tested without Postgres.
 */
export interface RefreshTokenRepo {
  insert(row: { userId: string; jti: string; tokenHash: string; expiresAt: Date }): Promise<void>
  findByJti(jti: string): Promise<RefreshToken | undefined>
  /**
   * Atomically revoke a still-active token; returns the row only if this call revoked it.
   * `replacedBy` records the successor's jti when revoking because of rotation.
   */
  revokeActive(jti: string, tokenHash: string, replacedBy?: string): Promise<RefreshToken | undefined>
  revokeAllForUser(userId: string): Promise<void>
  /**
   * Load the user and lock its row until the transaction ends. Every issuance, rotation
   * and revoke-all for a user takes this lock first, so they are serialized: a revoke-all
   * can never run concurrently with (and miss) a token being issued.
   */
  lockUser(userId: string): Promise<User | undefined>
  /** Delete expired tokens and tokens revoked before `revokedBefore`; returns the count. */
  deleteStale(now: Date, revokedBefore: Date): Promise<number>
  /** Run `fn` in a single transaction; repo passed to `fn` is bound to it. */
  transaction<T>(fn: (repo: RefreshTokenRepo) => Promise<T>): Promise<T>
}

type Database = typeof db
type Executor = Pick<Database, 'insert' | 'update' | 'delete' | 'select' | 'query'>

function createRepo(exec: Executor): Omit<RefreshTokenRepo, 'transaction'> {
  return {
    async insert(row) {
      await exec.insert(refreshTokens).values(row)
    },
    async findByJti(jti) {
      return exec.query.refreshTokens.findFirst({ where: eq(refreshTokens.jti, jti) })
    },
    async revokeActive(jti, tokenHash, replacedBy) {
      // UPDATE ... WHERE jti = ? AND token_hash = ? AND is_revoked = false RETURNING *
      const rows = await exec.update(refreshTokens)
        .set({ isRevoked: true, revokedAt: new Date(), replacedBy: replacedBy ?? null })
        .where(and(
          eq(refreshTokens.jti, jti),
          eq(refreshTokens.tokenHash, tokenHash),
          eq(refreshTokens.isRevoked, false)
        ))
        .returning()
      return rows[0]
    },
    async revokeAllForUser(userId) {
      await exec.update(refreshTokens)
        .set({ isRevoked: true, revokedAt: new Date() })
        .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.isRevoked, false)))
    },
    async lockUser(userId) {
      // NO KEY UPDATE: conflicts with itself (serializing token work per user) but not
      // with the FOR KEY SHARE locks taken by inserts referencing users (sessions, queries)
      const rows = await exec.select().from(users).where(eq(users.id, userId)).for('no key update')
      return rows[0]
    },
    async deleteStale(now, revokedBefore) {
      const rows = await exec.delete(refreshTokens)
        .where(or(
          lt(refreshTokens.expiresAt, now),
          and(eq(refreshTokens.isRevoked, true), isNotNull(refreshTokens.revokedAt), lt(refreshTokens.revokedAt, revokedBefore))
        ))
        .returning({ id: refreshTokens.id })
      return rows.length
    }
  }
}

/** Drizzle-backed repo; `database` is injectable for integration tests. */
export function createDrizzleRefreshTokenRepo(database: Database = db): RefreshTokenRepo {
  return {
    ...createRepo(database),
    transaction(fn) {
      return database.transaction(async (tx) => {
        // Nested transaction calls reuse the outer one
        const txRepo: RefreshTokenRepo = { ...createRepo(tx as unknown as Executor), transaction: (inner) => inner(txRepo) }
        return fn(txRepo)
      })
    }
  }
}

export const drizzleRefreshTokenRepo: RefreshTokenRepo = createDrizzleRefreshTokenRepo()
