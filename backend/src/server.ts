import type { Server } from 'bun'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import authRoutes from './routes/auth'
import { getAuthSecrets } from './config/secrets'
import sessionsRouter from './routes/sessions'
import queriesRouter from './routes/queries'
import { websocketHandler, type WebSocketData } from './websocket/handler'
import { startRefreshTokenCleanup } from './services/auth.service'

// Refuse to start without strong signing secrets
getAuthSecrets()

// Hourly purge of expired/long-revoked refresh tokens (timer does not keep the process alive)
startRefreshTokenCleanup()

const app = new Hono()

// Middleware
app.use('*', logger())

// Manual CORS middleware
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  c.header('Access-Control-Allow-Credentials', 'true')

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204)
  }

  await next()
})

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  })
})

// API info endpoint
app.get('/api', (c) => {
  return c.json({
    message: 'Dexter Web API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      sessions: '/api/sessions',
      queries: '/api/queries',
      websocket: 'ws://localhost:8000/stream'
    }
  })
})

// Mount routes
app.route('/api/auth', authRoutes)
app.route('/api/sessions', sessionsRouter)
app.route('/api/queries', queriesRouter)

const port = parseInt(process.env.PORT || '8000')

console.log(`🚀 Dexter API server starting on port ${port}`)
console.log(`📡 WebSocket available at ws://localhost:${port}/stream`)

// Export Bun server with WebSocket support
export default {
  port,
  fetch(req: Request, server: Server<WebSocketData>) {
    // Handle WebSocket upgrade for /stream endpoint
    const url = new URL(req.url)
    if (url.pathname === '/stream') {
      const upgraded = server.upgrade(req, {
        data: {
          userId: '',
          subscribedQueries: new Set<string>()
        } as WebSocketData
      })

      if (upgraded) {
        return undefined // Return undefined when upgrade is successful
      }

      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    // Handle regular HTTP requests with Hono
    // Expose the peer address to handlers (used for per-IP rate limits)
    return app.fetch(req, { clientIp: server.requestIP(req)?.address })
  },
  websocket: websocketHandler
}
