import type { ServerWebSocket } from 'bun'
import { verifyToken } from '../services/auth.service'
import { getQueryById } from '../services/query.service'

export interface WebSocketData {
  userId: string
  subscribedQueries: Set<string>
}

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
 * Handle authentication
 */
async function handleAuthentication(ws: ServerWebSocket<WebSocketData>, token: string) {
  try {
    const payload = verifyToken(token)
    ws.data.userId = payload.userId

    ws.send(JSON.stringify({
      type: 'authenticated',
      userId: payload.userId
    }))
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      error: {
        code: 'AUTH_FAILED',
        message: 'Authentication failed'
      }
    }))
    ws.close()
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
