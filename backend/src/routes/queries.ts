import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { requireAuth } from '../middleware/auth'
import {
  createQuery,
  getQueryById,
  getQueryEvents,
  cancelQuery,
  listQueries
} from '../services/query.service'
import { startQueryExecution, abortQueryExecution } from '../services/agent.service'
import { createQuerySchema, listQueriesQuerySchema } from '../types/query'
import { db } from '../db/client'
import { sessions } from '../db/schema'
import { and, eq } from 'drizzle-orm'
import { rateLimit, limiters, getClientIp, runningQueryLimiter, tooManyRequests } from '../middleware/rateLimit'
import { isAllowedModel, clampMaxIterations } from '../config/models'

const queriesRouter = new Hono()

// All query routes require authentication
queriesRouter.use('*', requireAuth)

/**
 * POST /api/queries
 * Submit a new query
 */
queriesRouter.post('/', rateLimit([
  { limiter: limiters.queryPerUser, key: (c) => c.get('user').id },
  { limiter: limiters.queryPerIp, key: getClientIp }
]), zValidator('json', createQuerySchema), async (c) => {
  const user = c.get('user')

  // Reserve a running-query slot before doing any work; released when execution ends
  const release = runningQueryLimiter.tryAcquire(user.id)
  if (!release) {
    return tooManyRequests(c, 30, `At most ${runningQueryLimiter.maxPerKey} queries may run at once`)
  }
  let started = false

  try {
    const { sessionId, query } = c.req.valid('json')

    const session = await db.query.sessions.findFirst({
      where: and(eq(sessions.id, sessionId), eq(sessions.userId, user.id))
    })

    if (!session) {
      throw new Error('SESSION_NOT_FOUND')
    }

    // Sessions created before the allow-list existed may hold arbitrary models
    if (!isAllowedModel(session.provider, session.model)) {
      return c.json({
        error: {
          code: 'MODEL_NOT_ALLOWED',
          message: 'The session model is not allowed; update the session to a supported model',
          timestamp: new Date().toISOString()
        }
      }, 400)
    }

    const newQuery = await createQuery(user.id, sessionId, query)

    // Start agent execution in background
    startQueryExecution(newQuery.id, query, {
      model: session.model,
      provider: session.provider,
      maxIterations: clampMaxIterations((session.config as { maxIterations?: unknown } | null)?.maxIterations)
    }, release)
    started = true

    // Match the WebSocket scheme to how the client reached us (direct or via TLS proxy)
    const isSecure = c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:'
    const wsProtocol = isSecure ? 'wss' : 'ws'

    return c.json({
      queryId: newQuery.id,
      sessionId: newQuery.sessionId,
      queryText: newQuery.queryText,
      status: newQuery.status,
      createdAt: newQuery.createdAt,
      streamUrl: `${wsProtocol}://${c.req.header('host')}/stream?queryId=${newQuery.id}`
    }, 201)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'SESSION_NOT_FOUND') {
        return c.json({
          error: {
            code: 'SESSION_NOT_FOUND',
            message: 'Session not found',
            timestamp: new Date().toISOString()
          }
        }, 404)
      }
    }

    console.error('Create query error:', error)
    return c.json({
      error: {
        code: 'QUERY_CREATION_FAILED',
        message: 'Failed to create query',
        timestamp: new Date().toISOString()
      }
    }, 500)
    } finally {
    // Execution owns the slot once started; otherwise free it now
    if (!started) release()
  }
})

/**
 * GET /api/queries
 * List user's queries
 */
queriesRouter.get('/', zValidator('query', listQueriesQuerySchema), async (c) => {
  try {
    const user = c.get('user')
    const queryParams = c.req.valid('query')

    const queries = await listQueries(user.id, queryParams)

    return c.json({
      queries: queries.map(q => ({
        queryId: q.id,
        sessionId: q.sessionId,
        queryText: q.queryText,
        status: q.status,
        answer: q.answer,
        createdAt: q.createdAt,
        completedAt: q.completedAt
      }))
    }, 200)
  } catch (error) {
    console.error('List queries error:', error)
    return c.json({
      error: {
        code: 'QUERY_LIST_FAILED',
        message: 'Failed to list queries',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * GET /api/queries/:queryId
 * Get query status and result
 */
queriesRouter.get('/:queryId', async (c) => {
  try {
    const user = c.get('user')
    const queryId = c.req.param('queryId')

    const query = await getQueryById(queryId, user.id)

    if (!query) {
      return c.json({
        error: {
          code: 'QUERY_NOT_FOUND',
          message: 'Query not found',
          timestamp: new Date().toISOString()
        }
      }, 404)
    }

    return c.json({
      queryId: query.id,
      sessionId: query.sessionId,
      queryText: query.queryText,
      status: query.status,
      answer: query.answer,
      iterations: query.iterations,
      totalTime: query.totalTime,
      tokenUsage: query.tokenUsage as {
        inputTokens: number
        outputTokens: number
        totalTokens: number
      } | null,
      tokensPerSecond: query.tokensPerSecond ? parseFloat(query.tokensPerSecond) : null,
      errorMessage: query.errorMessage,
      createdAt: query.createdAt,
      completedAt: query.completedAt
    }, 200)
  } catch (error) {
    console.error('Get query error:', error)
    return c.json({
      error: {
        code: 'QUERY_GET_FAILED',
        message: 'Failed to get query',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * GET /api/queries/:queryId/events
 * Get query execution events
 */
queriesRouter.get('/:queryId/events', async (c) => {
  try {
    const user = c.get('user')
    const queryId = c.req.param('queryId')
    const limit = parseInt(c.req.query('limit') || '100')
    const offset = parseInt(c.req.query('offset') || '0')

    const events = await getQueryEvents(queryId, user.id, { limit, offset })

    return c.json({
      queryId,
      events: events.map(e => ({
        eventId: e.id,
        type: e.eventType,
        data: e.eventData,
        timestamp: e.timestamp
      })),
      pagination: {
        total: events.length,
        limit,
        offset
      }
    }, 200)
  } catch (error) {
    if (error instanceof Error && error.message === 'QUERY_NOT_FOUND') {
      return c.json({
        error: {
          code: 'QUERY_NOT_FOUND',
          message: 'Query not found',
          timestamp: new Date().toISOString()
        }
      }, 404)
    }

    console.error('Get query events error:', error)
    return c.json({
      error: {
        code: 'QUERY_EVENTS_FAILED',
        message: 'Failed to get query events',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * DELETE /api/queries/:queryId
 * Cancel query execution
 */
queriesRouter.delete('/:queryId', async (c) => {
  try {
    const user = c.get('user')
    const queryId = c.req.param('queryId')

    const cancelled = await cancelQuery(queryId, user.id)

    if (!cancelled) {
      return c.json({
        error: {
          code: 'QUERY_NOT_FOUND_OR_COMPLETED',
          message: 'Query not found or already completed',
          timestamp: new Date().toISOString()
        }
      }, 404)
    }

    abortQueryExecution(queryId)

    return c.json({
      queryId,
      status: 'cancelled',
      message: 'Query execution cancelled successfully'
    }, 200)
  } catch (error) {
    console.error('Cancel query error:', error)
    return c.json({
      error: {
        code: 'QUERY_CANCEL_FAILED',
        message: 'Failed to cancel query',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

export default queriesRouter
