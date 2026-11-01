import { pgTable, uuid, varchar, integer, timestamp, date } from 'drizzle-orm/pg-core'
import { users } from './users'

export const usageTracking = pgTable('usage_tracking', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  requestCount: integer('request_count').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  totalTime: integer('total_time').notNull().default(0), // milliseconds
  resourceType: varchar('resource_type', { length: 50 }).notNull(), // 'query', 'api_call', etc.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export type UsageTracking = typeof usageTracking.$inferSelect
export type NewUsageTracking = typeof usageTracking.$inferInsert
