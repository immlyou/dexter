import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { refreshTokens, users, type RefreshToken, type User } from '../db/schema'

/**
 * Persistence operations needed for refresh-token issuance and rotation.
 * Abstracted so the rotation logic can be unit-tested without Postgres.
 */
export interface RefreshTokenRepo {
  insert(row: { userId: string; jti: string; tokenHash: string; expiresAt: Date }): Promise<void>
  findByJti(jti: string): Promise<RefreshToken | undefined>
  /** Atomically revoke a still-active token; returns the row only if this call revoked it. */
  revokeActive(jti: string, tokenHash: string): Promise<RefreshToken | undefined>
  revokeAllForUser(userId: string): Promise<void>
  getUser(userId: string): Promise<User | undefined>
  /** Run `fn` in a single transaction; repo passed to `fn` is bound to it. */
  transaction<T>(fn: (repo: RefreshTokenRepo) => Promise<T>): Promise<T>
}

type Executor = Pick<typeof db, 'insert' | 'update' | 'query'>

function createRepo(exec: Executor): Omit<RefreshTokenRepo, 'transaction'> {
  return {
    async insert(row) {
      await exec.insert(refreshTokens).values(row)
    },
    async findByJti(jti) {
      return exec.query.refreshTokens.findFirst({ where: eq(refreshTokens.jti, jti) })
    },
    async revokeActive(jti, tokenHash) {
      // UPDATE ... WHERE jti = ? AND token_hash = ? AND is_revoked = false RETURNING *
      const rows = await exec.update(refreshTokens)
        .set({ isRevoked: true })
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
        .set({ isRevoked: true })
        .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.isRevoked, false)))
    },
    async getUser(userId) {
      return exec.query.users.findFirst({ where: eq(users.id, userId) })
    }
  }
}

export const drizzleRefreshTokenRepo: RefreshTokenRepo = {
  ...createRepo(db),
  transaction(fn) {
    return db.transaction(async (tx) => {
      // Nested transaction calls reuse the outer one
      const txRepo: RefreshTokenRepo = { ...createRepo(tx as unknown as Executor), transaction: (inner) => inner(txRepo) }
      return fn(txRepo)
    })
  }
}
