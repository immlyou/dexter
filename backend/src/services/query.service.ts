import { db } from '../db/client'
import { queries, queryEvents, sessions, type Query, type QueryEvent } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import type { QueryEventData, QueryStatus } from '../types/query'

/**
 * Create a new query
 */
export async function createQuery(
  userId: string,
  sessionId: string,
  queryText: string
): Promise<Query> {
  // Verify session belongs to user
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      eq(sessions.userId, userId)
    )
  })

  if (!session) {
    throw new Error('SESSION_NOT_FOUND')
  }

  // Create query
  const result = await db.insert(queries).values({
    sessionId,
    userId,
    queryText,
    status: 'processing'
  }).returning()

  const newQuery = result[0]
  if (!newQuery) {
    throw new Error('QUERY_CREATION_FAILED')
  }

  return newQuery
}

/**
 * Get query by ID
 */
export async function getQueryById(
  queryId: string,
  userId: string
): Promise<Query | null> {
  const query = await db.query.queries.findFirst({
    where: and(
      eq(queries.id, queryId),
      eq(queries.userId, userId)
    )
  })

  return query || null
}

/**
 * Get query events
 */
export async function getQueryEvents(
  queryId: string,
  userId: string,
  options: {
    limit: number
    offset: number
  }
): Promise<QueryEvent[]> {
  // Verify query belongs to user
  const query = await db.query.queries.findFirst({
    where: and(
      eq(queries.id, queryId),
      eq(queries.userId, userId)
    )
  })

  if (!query) {
    throw new Error('QUERY_NOT_FOUND')
  }

  // Get events
  const events = await db
    .select()
    .from(queryEvents)
    .where(eq(queryEvents.queryId, queryId))
    .orderBy(queryEvents.timestamp)
    .limit(options.limit)
    .offset(options.offset)

  return events
}

/**
 * Add query event
 */
export async function addQueryEvent(
  queryId: string,
  eventType: string,
  eventData: QueryEventData
): Promise<void> {
  await db.insert(queryEvents).values({
    queryId,
    eventType,
    eventData: eventData as unknown as Record<string, unknown>
  })
}

/**
 * Update query status
 */
export async function updateQueryStatus(
  queryId: string,
  status: QueryStatus,
  data?: {
    answer?: string
    iterations?: number
    totalTime?: number
    tokenUsage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    tokensPerSecond?: number
    errorMessage?: string
  }
): Promise<boolean> {
  const updateData: Partial<Query> = {
    status
  }

  if (data?.answer) updateData.answer = data.answer
  if (data?.iterations) updateData.iterations = data.iterations
  if (data?.totalTime) updateData.totalTime = data.totalTime
  if (data?.tokenUsage) updateData.tokenUsage = data.tokenUsage as unknown as Record<string, unknown>
  if (data?.tokensPerSecond) updateData.tokensPerSecond = String(data.tokensPerSecond)
  if (data?.errorMessage) updateData.errorMessage = data.errorMessage

  if (status === 'completed' || status === 'error' || status === 'cancelled') {
    updateData.completedAt = new Date()
  }

  // Only a processing query may transition, so a late completed/error write can
  // never overwrite a cancelled (or otherwise terminal) status.
  const updated = await db
    .update(queries)
    .set(updateData)
    .where(and(eq(queries.id, queryId), eq(queries.status, 'processing')))
    .returning({ id: queries.id })

  return updated.length > 0
}

/**
 * Cancel query
 */
export async function cancelQuery(
  queryId: string,
  userId: string
): Promise<boolean> {
  // Verify query belongs to user
  const query = await db.query.queries.findFirst({
    where: and(
      eq(queries.id, queryId),
      eq(queries.userId, userId)
    )
  })

  if (!query) {
    return false
  }

  // Can only cancel processing queries
  if (query.status !== 'processing') {
    return false
  }

  // Update status to cancelled
  await updateQueryStatus(queryId, 'cancelled')

  return true
}

/**
 * List user queries
 */
export async function listQueries(
  userId: string,
  options: {
    sessionId?: string
    status?: QueryStatus
    limit: number
    offset: number
  }
): Promise<Query[]> {
  let whereConditions = [eq(queries.userId, userId)]

  if (options.sessionId) {
    whereConditions.push(eq(queries.sessionId, options.sessionId))
  }

  if (options.status) {
    whereConditions.push(eq(queries.status, options.status))
  }

  const results = await db
    .select()
    .from(queries)
    .where(and(...whereConditions))
    .orderBy(desc(queries.createdAt))
    .limit(options.limit)
    .offset(options.offset)

  return results
}
