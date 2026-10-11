import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { requireAuth } from '../middleware/auth'
import {
  createSession,
  listSessions,
  getSessionById,
  updateSession,
  deleteSession
} from '../services/session.service'
import {
  createSessionSchema,
  updateSessionSchema,
  listSessionsQuerySchema
} from '../types/session'

const sessionsRouter = new Hono()

// All session routes require authentication
sessionsRouter.use('*', requireAuth)

/**
 * POST /api/sessions
 * Create a new session
 */
sessionsRouter.post('/', zValidator('json', createSessionSchema), async (c) => {
  try {
    const user = c.get('user')
    const data = c.req.valid('json')

    const session = await createSession(user.id, data)

    return c.json({
      sessionId: session.id,
      name: session.name,
      model: session.model,
      provider: session.provider,
      config: session.config,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    }, 201)
  } catch (error) {
    console.error('Create session error:', error)
    return c.json({
      error: {
        code: 'SESSION_CREATION_FAILED',
        message: 'Failed to create session',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * GET /api/sessions
 * List user's sessions
 */
sessionsRouter.get('/', zValidator('query', listSessionsQuerySchema), async (c) => {
  try {
    const user = c.get('user')
    const query = c.req.valid('query')

    const result = await listSessions(user.id, query)

    return c.json({
      sessions: result.sessions.map(session => ({
        sessionId: session.id,
        name: session.name,
        model: session.model,
        provider: session.provider,
        queryCount: session.queryCount,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      })),
      pagination: result.pagination
    }, 200)
  } catch (error) {
    console.error('List sessions error:', error)
    return c.json({
      error: {
        code: 'SESSION_LIST_FAILED',
        message: 'Failed to list sessions',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * GET /api/sessions/:sessionId
 * Get session details
 */
sessionsRouter.get('/:sessionId', async (c) => {
  try {
    const user = c.get('user')
    const sessionId = c.req.param('sessionId')

    const session = await getSessionById(sessionId, user.id)

    if (!session) {
      return c.json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
          timestamp: new Date().toISOString()
        }
      }, 404)
    }

    return c.json({
      sessionId: session.id,
      name: session.name,
      model: session.model,
      provider: session.provider,
      config: session.config,
      queries: session.queries.map(q => ({
        queryId: q.id,
        queryText: q.queryText,
        status: q.status,
        createdAt: q.createdAt
      })),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    }, 200)
  } catch (error) {
    console.error('Get session error:', error)
    return c.json({
      error: {
        code: 'SESSION_GET_FAILED',
        message: 'Failed to get session',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * PATCH /api/sessions/:sessionId
 * Update session
 */
sessionsRouter.patch('/:sessionId', zValidator('json', updateSessionSchema), async (c) => {
  try {
    const user = c.get('user')
    const sessionId = c.req.param('sessionId')
    const data = c.req.valid('json')

    const session = await updateSession(sessionId, user.id, data)

    if (!session) {
      return c.json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
          timestamp: new Date().toISOString()
        }
      }, 404)
    }

    return c.json({
      sessionId: session.id,
      name: session.name,
      model: session.model,
      provider: session.provider,
      config: session.config,
      updatedAt: session.updatedAt
    }, 200)
  } catch (error) {
    console.error('Update session error:', error)
    return c.json({
      error: {
        code: 'SESSION_UPDATE_FAILED',
        message: 'Failed to update session',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * DELETE /api/sessions/:sessionId
 * Delete session (archive)
 */
sessionsRouter.delete('/:sessionId', async (c) => {
  try {
    const user = c.get('user')
    const sessionId = c.req.param('sessionId')

    const deleted = await deleteSession(sessionId, user.id)

    if (!deleted) {
      return c.json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
          timestamp: new Date().toISOString()
        }
      }, 404)
    }

    return c.body(null, 204)
  } catch (error) {
    console.error('Delete session error:', error)
    return c.json({
      error: {
        code: 'SESSION_DELETE_FAILED',
        message: 'Failed to delete session',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

export default sessionsRouter
