import { pgTable, uuid, varchar, timestamp, boolean, index } from 'drizzle-orm/pg-core'
import { users } from './users'

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // Random per-token id (JWT `jti`), used for O(1) lookup
  jti: varchar('jti', { length: 64 }).notNull().unique(),
  // SHA-256 hex digest of the full refresh token
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  isRevoked: boolean('is_revoked').notNull().default(false),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // jti of the token that replaced this one on rotation (null: logout/revoke-all)
  replacedBy: varchar('replaced_by', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, (table) => [
  index('refresh_tokens_user_id_idx').on(table.userId),
  index('refresh_tokens_expires_at_idx').on(table.expiresAt)
])

export type RefreshToken = typeof refreshTokens.$inferSelect
export type NewRefreshToken = typeof refreshTokens.$inferInsert
