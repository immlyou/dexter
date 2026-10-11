import type { Context, Next } from 'hono'
import { verifyToken, getUserById, type JWTPayload } from '../services/auth.service'
import type { User } from '../db/schema'

// Extend Hono context to include user
declare module 'hono' {
  interface ContextVariableMap {
    user: User
    jwtPayload: JWTPayload
  }
}

/**
 * Extract token from Authorization header
 */
function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null
  }

  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null
  }

  return parts[1] || null
}

/**
 * Middleware to require authentication
 * Verifies JWT token and attaches user to context
 */
export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  const token = extractToken(authHeader)

  if (!token) {
    return c.json({
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
        timestamp: new Date().toISOString()
      }
    }, 401)
  }

  try {
    // Verify token
    const payload = verifyToken(token)

    // Get user from database
    const user = await getUserById(payload.userId)

    if (!user) {
      return c.json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          timestamp: new Date().toISOString()
        }
      }, 401)
    }

    if (!user.isActive) {
      return c.json({
        error: {
          code: 'USER_INACTIVE',
          message: 'User account is inactive',
          timestamp: new Date().toISOString()
        }
      }, 403)
    }

    // Attach user and payload to context
    c.set('user', user)
    c.set('jwtPayload', payload)

    await next()
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'TOKEN_EXPIRED') {
        return c.json({
          error: {
            code: 'AUTH_EXPIRED_TOKEN',
            message: 'Authentication token has expired',
            timestamp: new Date().toISOString()
          }
        }, 401)
      }

      if (error.message === 'TOKEN_INVALID' || error.message === 'TOKEN_VERIFICATION_FAILED') {
        return c.json({
          error: {
            code: 'AUTH_INVALID_TOKEN',
            message: 'Invalid authentication token',
            timestamp: new Date().toISOString()
          }
        }, 401)
      }
    }

    // Generic error
    return c.json({
      error: {
        code: 'AUTH_FAILED',
        message: 'Authentication failed',
        timestamp: new Date().toISOString()
      }
    }, 401)
  }
}

/**
 * Middleware for optional authentication
 * Attaches user to context if token is valid, but doesn't fail if not
 */
export async function optionalAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization')
  const token = extractToken(authHeader)

  if (token) {
    try {
      const payload = verifyToken(token)
      const user = await getUserById(payload.userId)

      if (user && user.isActive) {
        c.set('user', user)
        c.set('jwtPayload', payload)
      }
    } catch (error) {
      // Silently fail for optional auth
    }
  }

  await next()
}
