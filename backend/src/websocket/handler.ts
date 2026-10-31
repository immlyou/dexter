import type { ServerWebSocket } from 'bun'
import { verifyAccessToken, getUserById } from '../services/auth.service'
import { getQueryById } from '../services/query.service'

export interface WebSocketData {
  userId: string
  subscribedQueries: Set<string>
  /** Closes the connection when the access token expires */
  expiryTimer?: ReturnType<typeof setTimeout>
}

// Application close code: authentication failed or expired
export const WS_CLOSE_AUTH = 4001

// Store all connected clients
const clients = new Map<ServerWebSocket<WebSocketData>, WebSocketData>()

/**
 * WebSocket connection handler
 */
export const websocketHandler = {
  /**
   * Handle new WebSocket connection
   */
  open(ws: ServerWebSocket<WebSocketData>) {
    console.log('WebSocket client connected')

    // Initialize client data
    ws.data.subscribedQueries = new Set()
    clients.set(ws, ws.data)
  },

  /**
   * Handle incoming WebSocket messages
   */
  async message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    try {
      const data = JSON.parse(message.toString())

      switch (data.type) {
        case 'authenticate':
          await handleAuthentication(ws, data.token)
          break

        case 'subscribe':
          await handleSubscribe(ws, data.queryId)
          break

        case 'unsubscribe':
          handleUnsubscribe(ws, data.queryId)
          break

        default:
          ws.send(JSON.stringify({
            type: 'error',
            error: {
              code: 'UNKNOWN_MESSAGE_TYPE',
              message: 'Unknown message type'
            }
          }))
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        error: {
          code: 'INVALID_MESSAGE',
          message: 'Invalid message format'
        }
      }))
    }
  },

  /**
   * Handle WebSocket connection close
   */
  close(ws: ServerWebSocket<WebSocketData>) {
    console.log('WebSocket client disconnected')
    clearTimeout(ws.data.expiryTimer)
    clients.delete(ws)
  },

  /**
   * Handle WebSocket errors
   */
  error(ws: ServerWebSocket<WebSocketData>, error: Error) {
    console.error('WebSocket error:', error)
  }
}

/**
 * Handle authentication. Only access tokens for an existing, active user are accepted,
 * and the connection is closed when the token expires.
 */
export async function handleAuthentication(ws: ServerWebSocket<WebSocketData>, token: unknown) {
  const fail = () => {
    clearTimeout(ws.data.expiryTimer)
    ws.data.userId = ''
    ws.data.subscribedQueries.clear()
    ws.send(JSON.stringify({
      type: 'error',
      error: {
        code: 'AUTH_FAILED',
        message: 'Authentication failed'
      }
    }))
    ws.close(WS_CLOSE_AUTH, 'Authentication failed')
  }

  try {
    if (typeof token !== 'string') return fail()
    const claims = verifyAccessToken(token)
    const user = await getUserById(claims.userId)
    if (!user || !user.isActive) return fail()

    // Re-authenticating as a different user must not keep the previous user's subscriptions
    if (ws.data.userId && ws.data.userId !== user.id) {
      ws.data.subscribedQueries.clear()
    }
    ws.data.userId = user.id

    clearTimeout(ws.data.expiryTimer)
    ws.data.expiryTimer = setTimeout(() => {
      ws.data.userId = ''
      ws.data.subscribedQueries.clear()
      ws.close(WS_CLOSE_AUTH, 'Token expired')
    }, Math.max(0, claims.exp * 1000 - Date.now()))

    ws.send(JSON.stringify({
      type: 'authenticated',
      userId: user.id,
      expiresAt: new Date(claims.exp * 1000).toISOString()
    }))
  } catch {
    fail()
  }
}

/**
 * Handle query subscription
 */
async function handleSubscribe(ws: ServerWebSocket<WebSocketData>, queryId: string) {
  if (!ws.data.userId) {
    ws.send(JSON.stringify({
      type: 'error',
      error: {
        code: 'NOT_AUTHENTICATED',
        message: 'Must authenticate before subscribing'
      }
    }))
    return
  }

  // Verify query belongs to user
  const query = await getQueryById(queryId, ws.data.userId)

  if (!query) {
    ws.send(JSON.stringify({
      type: 'error',
      error: {
        code: 'QUERY_NOT_FOUND',
        message: 'Query not found or access denied'
      }
    }))
    return
  }

  // Add to subscriptions
  ws.data.subscribedQueries.add(queryId)

  ws.send(JSON.stringify({
    type: 'subscribed',
    queryId,
    status: query.status
  }))
}

/**
 * Handle query unsubscription
 */
function handleUnsubscribe(ws: ServerWebSocket<WebSocketData>, queryId: string) {
  ws.data.subscribedQueries.delete(queryId)

  ws.send(JSON.stringify({
    type: 'unsubscribed',
    queryId
  }))
}

/**
 * Broadcast event to all subscribers of a query
 */
export function broadcastQueryEvent(
  queryId: string,
  event: {
    type: string
    data: unknown
    timestamp: Date
  }
) {
  for (const [ws, data] of clients.entries()) {
    if (data.subscribedQueries.has(queryId)) {
      ws.send(JSON.stringify({
        type: 'event',
        queryId,
        event: {
          type: event.type,
          data: event.data
        },
        timestamp: event.timestamp.toISOString()
      }))
    }
  }
}
