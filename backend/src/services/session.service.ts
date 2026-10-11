import { db } from '../db/client'
import { sessions, queries, type Session, type NewSession } from '../db/schema'
import { eq, and, desc, asc, sql, count } from 'drizzle-orm'

/**
 * Create a new session
 */
export async function createSession(
  userId: string,
  data: {
    name?: string
    model: string
    provider: string
    config?: Record<string, unknown>
  }
): Promise<Session> {
  const result = await db.insert(sessions).values({
    userId,
    name: data.name,
    model: data.model,
    provider: data.provider,
    config: data.config || {}
  }).returning()

  const newSession = result[0]
  if (!newSession) {
    throw new Error('SESSION_CREATION_FAILED')
  }

  return newSession
}

/**
 * List user's sessions
 */
export async function listSessions(
  userId: string,
  options: {
    limit: number
    offset: number
    sort: 'createdAt' | 'updatedAt'
    order: 'asc' | 'desc'
  }
): Promise<{
  sessions: Array<Session & { queryCount: number }>
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}> {
  // Get total count
  const totalResult = await db
    .select({ count: count() })
    .from(sessions)
    .where(and(
      eq(sessions.userId, userId),
      eq(sessions.isArchived, false)
    ))

  const total = totalResult[0]?.count || 0

  // Get sessions with query count
  const orderColumn = options.sort === 'createdAt' ? sessions.createdAt : sessions.updatedAt
  const orderFn = options.order === 'asc' ? asc : desc

  const sessionsResult = await db
    .select({
      session: sessions,
      queryCount: count(queries.id)
    })
    .from(sessions)
    .leftJoin(queries, eq(queries.sessionId, sessions.id))
    .where(and(
      eq(sessions.userId, userId),
      eq(sessions.isArchived, false)
    ))
    .groupBy(sessions.id)
    .orderBy(orderFn(orderColumn))
    .limit(options.limit)
    .offset(options.offset)

  const sessionsWithCount = sessionsResult.map(row => ({
    ...row.session,
    queryCount: Number(row.queryCount)
  }))

  return {
    sessions: sessionsWithCount,
    pagination: {
      total: Number(total),
      limit: options.limit,
      offset: options.offset,
      hasMore: options.offset + options.limit < Number(total)
    }
  }
}

/**
 * Get session by ID
 */
export async function getSessionById(
  sessionId: string,
  userId: string
): Promise<(Session & { queries: Array<{ id: string; queryText: string; status: string; createdAt: Date }> }) | null> {
  // Get session
  const session = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      eq(sessions.userId, userId)
    )
  })

  if (!session) {
    return null
  }

  // Get queries for this session
  const sessionQueries = await db
    .select({
      id: queries.id,
      queryText: queries.queryText,
      status: queries.status,
      createdAt: queries.createdAt
    })
    .from(queries)
    .where(eq(queries.sessionId, sessionId))
    .orderBy(desc(queries.createdAt))
    .limit(20)

  return {
    ...session,
    queries: sessionQueries
  }
}

/**
 * Update session
 */
export async function updateSession(
  sessionId: string,
  userId: string,
  data: {
    name?: string
    model?: string
    provider?: string
    config?: Record<string, unknown>
  }
): Promise<Session | null> {
  // Verify session belongs to user
  const existingSession = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      eq(sessions.userId, userId)
    )
  })

  if (!existingSession) {
    return null
  }

  // Update session
  const result = await db
    .update(sessions)
    .set({
      ...data,
      updatedAt: new Date()
    })
    .where(eq(sessions.id, sessionId))
    .returning()

  return result[0] || null
}

/**
 * Delete session (archive)
 */
export async function deleteSession(
  sessionId: string,
  userId: string
): Promise<boolean> {
  // Verify session belongs to user
  const existingSession = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      eq(sessions.userId, userId)
    )
  })

  if (!existingSession) {
    return false
  }

  // Archive session (soft delete)
  await db
    .update(sessions)
    .set({
      isArchived: true,
      updatedAt: new Date()
    })
    .where(eq(sessions.id, sessionId))

  return true
}
