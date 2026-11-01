import { pgTable, uuid, varchar, timestamp, boolean, text } from 'drizzle-orm/pg-core'
import { users } from './users'

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  keyHash: varchar('key_hash', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  prefix: varchar('prefix', { length: 20 }).notNull(), // dex_sk_live_
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  isActive: boolean('is_active').notNull().default(true),
  scopes: text('scopes').array().notNull().default(['read', 'write']),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export type ApiKey = typeof apiKeys.$inferSelect
export type NewApiKey = typeof apiKeys.$inferInsert
