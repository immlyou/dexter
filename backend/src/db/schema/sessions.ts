import { pgTable, uuid, varchar, timestamp, jsonb, boolean } from 'drizzle-orm/pg-core'
import { users } from './users'

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }),
  model: varchar('model', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  config: jsonb('config').notNull().default({}),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
})

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
