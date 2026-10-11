import { Hono } from 'hono'
import { logger } from 'hono/logger'
import authRoutes from './routes/auth'
import sessionsRouter from './routes/sessions'
import queriesRouter from './routes/queries'

const app = new Hono()

// Middleware
app.use('*', logger())

// Manual CORS middleware - must be before routes
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  c.header('Access-Control-Allow-Credentials', 'true')

  if (c.req.method === 'OPTIONS') {
    return c.text('', 204)
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
      models: '/api/models (coming soon)'
    }
  })
})

// Mount routes
app.route('/api/auth', authRoutes)
app.route('/api/sessions', sessionsRouter)
app.route('/api/queries', queriesRouter)

const port = parseInt(process.env.PORT || '8000')

console.log(`🚀 Dexter API server starting on port ${port}`)

export default {
  port,
  fetch: app.fetch
}
