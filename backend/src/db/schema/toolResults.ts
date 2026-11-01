import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { queries } from './queries'

export const toolResults = pgTable('tool_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  queryId: uuid('query_id').notNull().references(() => queries.id, { onDelete: 'cascade' }),
  toolName: varchar('tool_name', { length: 100 }).notNull(),
  input: jsonb('input').notNull(),
  output: text('output'),
  errorMessage: text('error_message'),
  executionTime: timestamp('execution_time', { withTimezone: true }).notNull().defaultNow()
})

export type ToolResult = typeof toolResults.$inferSelect
export type NewToolResult = typeof toolResults.$inferInsert
