import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { requireAuth } from '../middleware/auth'
import { rateLimit, limiters, getClientIp, emailKey } from '../middleware/rateLimit'
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser
} from '../services/auth.service'
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema
} from '../types/auth'

const auth = new Hono()

/**
 * POST /api/auth/register
 * Register a new user
 */
auth.post('/register', rateLimit([
  { limiter: limiters.registerPerIp, key: getClientIp }
]), zValidator('json', registerSchema), async (c) => {
  try {
    const { email, password, name } = c.req.valid('json')

    const { user, tokens } = await registerUser(email, password, name)

    return c.json({
      userId: user.id,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        createdAt: user.createdAt
      }
    }, 201)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'USER_ALREADY_EXISTS') {
        return c.json({
          error: {
            code: 'USER_ALREADY_EXISTS',
            message: 'A user with this email already exists',
            timestamp: new Date().toISOString()
          }
        }, 409)
      }
    }

    console.error('Registration error:', error)
    return c.json({
      error: {
        code: 'REGISTRATION_FAILED',
        message: 'Failed to register user',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * POST /api/auth/login
 * Login a user
 */
auth.post('/login', rateLimit([
  { limiter: limiters.loginPerIp, key: getClientIp },
  { limiter: limiters.loginPerAccount, key: emailKey }
]), zValidator('json', loginSchema), async (c) => {
  try {
    const { email, password } = c.req.valid('json')

    const { user, tokens } = await loginUser(email, password)

    return c.json({
      userId: user.id,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan
      }
    }, 200)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'INVALID_CREDENTIALS') {
        return c.json({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
            timestamp: new Date().toISOString()
          }
        }, 401)
      }

      if (error.message === 'USER_INACTIVE') {
        return c.json({
          error: {
            code: 'USER_INACTIVE',
            message: 'User account is inactive',
            timestamp: new Date().toISOString()
          }
        }, 403)
      }
    }

    console.error('Login error:', error)
    return c.json({
      error: {
        code: 'LOGIN_FAILED',
        message: 'Failed to login',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
auth.post('/refresh', zValidator('json', refreshTokenSchema), async (c) => {
  try {
    const { refreshToken } = c.req.valid('json')

    const tokens = await refreshAccessToken(refreshToken)

    return c.json({
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken
    }, 200)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'INVALID_REFRESH_TOKEN') {
        return c.json({
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Invalid refresh token',
            timestamp: new Date().toISOString()
          }
        }, 401)
      }

      if (error.message === 'REFRESH_TOKEN_EXPIRED') {
        return c.json({
          error: {
            code: 'REFRESH_TOKEN_EXPIRED',
            message: 'Refresh token has expired',
            timestamp: new Date().toISOString()
          }
        }, 401)
      }

      if (error.message === 'REFRESH_RETRY') {
        // Another client (e.g. a second tab) just rotated this token: reread stored tokens
        return c.json({
          error: {
            code: 'REFRESH_RETRY',
            message: 'Refresh token was just rotated by another request; retry with the latest token',
            timestamp: new Date().toISOString()
          }
        }, 409)
      }

      if (error.message === 'REFRESH_TOKEN_REUSED') {
        return c.json({
          error: {
            code: 'REFRESH_TOKEN_REUSED',
            message: 'Refresh token was already used; all sessions have been revoked',
            timestamp: new Date().toISOString()
          }
        }, 401)
      }

      if (error.message === 'USER_INACTIVE') {
        return c.json({
          error: {
            code: 'USER_INACTIVE',
            message: 'User account is inactive',
            timestamp: new Date().toISOString()
          }
        }, 403)
      }

      if (error.message === 'TOKEN_EXPIRED' || error.message === 'TOKEN_INVALID' || error.message === 'TOKEN_VERIFICATION_FAILED') {
        return c.json({
          error: {
            code: 'INVALID_REFRESH_TOKEN',
            message: 'Invalid or expired refresh token',
            timestamp: new Date().toISOString()
          }
        }, 401)
      }
    }

    console.error('Token refresh error:', error)
    return c.json({
      error: {
        code: 'REFRESH_FAILED',
        message: 'Failed to refresh token',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * POST /api/auth/logout
 * Logout user
 */
auth.post('/logout', zValidator('json', logoutSchema), async (c) => {
  try {
    const { refreshToken } = c.req.valid('json')

    await logoutUser(refreshToken)

    return c.json({
      success: true,
      message: 'Logged out successfully'
    }, 200)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('TOKEN_')) {
      return c.json({
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid or expired refresh token',
          timestamp: new Date().toISOString()
        }
      }, 401)
    }

    console.error('Logout error:', error)
    return c.json({
      error: {
        code: 'LOGOUT_FAILED',
        message: 'Failed to logout',
        timestamp: new Date().toISOString()
      }
    }, 500)
  }
})

/**
 * GET /api/auth/me
 * Get current user info
 */
auth.get('/me', requireAuth, async (c) => {
  const user = c.get('user')

  return c.json({
    userId: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan,
    preferences: user.preferences,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  }, 200)
})

export default auth
