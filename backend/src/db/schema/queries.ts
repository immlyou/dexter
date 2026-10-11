import { pgTable, uuid, text, varchar, integer, timestamp, jsonb, decimal } from 'drizzle-orm/pg-core'
import { sessions } from './sessions'
import { users } from './users'

export const queries = pgTable('queries', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  queryText: text('query_text').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('processing'),
  answer: text('answer'),
  iterations: integer('iterations'),
  totalTime: integer('total_time'), // milliseconds
  tokenUsage: jsonb('token_usage'),
  tokensPerSecond: decimal('tokens_per_second', { precision: 10, scale: 2 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true })
})

export type Query = typeof queries.$inferSelect
export type NewQuery = typeof queries.$inferInsert
