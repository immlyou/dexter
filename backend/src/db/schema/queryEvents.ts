import { pgTable, uuid, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { queries } from './queries'

export const queryEvents = pgTable('query_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  queryId: uuid('query_id').notNull().references(() => queries.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  eventData: jsonb('event_data').notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow()
})

export type QueryEvent = typeof queryEvents.$inferSelect
export type NewQueryEvent = typeof queryEvents.$inferInsert
