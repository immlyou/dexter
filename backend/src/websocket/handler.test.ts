import { describe, test, expect, mock, beforeEach } from 'bun:test'
import jwt from 'jsonwebtoken'
import type { ServerWebSocket } from 'bun'
import type { User } from '../db/schema'

// Users visible to getUserById; the real DB client is never touched
const users = new Map<string, User>()
mock.module('../db/client', () => ({
  db: { query: { users: { findFirst: async () => [...users.values()][0] } } }
}))

const { handleAuthentication, WS_CLOSE_AUTH } = await import('./handler')
const { generateAccessToken, generateRefreshToken } = await import('../services/auth.service')
const { getAuthSecrets } = await import('../config/secrets')
type WebSocketData = import('./handler').WebSocketData

function fakeSocket() {
  const sent: Array<Record<string, unknown>> = []
  const closed: Array<{ code?: number; reason?: string }> = []
  const ws = {
    data: { userId: '', subscribedQueries: new Set<string>() } as WebSocketData,
    send: (msg: string) => { sent.push(JSON.parse(msg)) },
    close: (code?: number, reason?: string) => { closed.push({ code, reason }) }
  }
  return { ws: ws as unknown as ServerWebSocket<WebSocketData>, sent, closed, data: ws.data }
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: crypto.randomUUID(), email: 'ws@example.com', passwordHash: 'x', name: null, plan: 'free',
    preferences: {}, emailVerified: false, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    ...overrides
  }
}

const accessFor = (u: User) => generateAccessToken({ userId: u.id, email: u.email, plan: u.plan })

describe('WebSocket authentication', () => {
  beforeEach(() => users.clear())

  test('accepts a valid access token for an active user and schedules expiry close', async () => {
    const user = makeUser()
    users.set(user.id, user)
    const s = fakeSocket()
    await handleAuthentication(s.ws, accessFor(user))
    expect(s.data.userId).toBe(user.id)
    expect(s.sent[0]?.type).toBe('authenticated')
    expect(s.closed).toHaveLength(0)
    expect(s.data.expiryTimer).toBeDefined()
    clearTimeout(s.data.expiryTimer)
  })

  test('rejects refresh tokens', async () => {
    const user = makeUser()
    users.set(user.id, user)
    const s = fakeSocket()
    await handleAuthentication(s.ws, generateRefreshToken(user.id).token)
    expect(s.data.userId).toBe('')
    expect(s.closed[0]?.code).toBe(WS_CLOSE_AUTH)
  })

  test('rejects tokens for missing or inactive users', async () => {
    const ghost = makeUser()
    const s1 = fakeSocket()
    await handleAuthentication(s1.ws, accessFor(ghost))
    expect(s1.closed[0]?.code).toBe(WS_CLOSE_AUTH)

    const inactive = makeUser({ isActive: false })
    users.set(inactive.id, inactive)
    const s2 = fakeSocket()
    await handleAuthentication(s2.ws, accessFor(inactive))
    expect(s2.data.userId).toBe('')
    expect(s2.closed[0]?.code).toBe(WS_CLOSE_AUTH)
  })

  test('rejects non-string tokens', async () => {
    const s = fakeSocket()
    await handleAuthentication(s.ws, { token: 'x' })
    expect(s.closed[0]?.code).toBe(WS_CLOSE_AUTH)
  })

  test('closes the connection and drops subscriptions when the token expires', async () => {
    const user = makeUser()
    users.set(user.id, user)
    // Token that expires one second from now
    const token = jwt.sign(
      { userId: user.id, email: user.email, plan: user.plan, typ: 'access', exp: Math.floor(Date.now() / 1000) + 1 },
      getAuthSecrets().accessSecret,
      { issuer: 'dexter-api', audience: 'dexter-client' }
    )
    const s = fakeSocket()
    await handleAuthentication(s.ws, token)
    s.data.subscribedQueries.add('q1')
    expect(s.closed).toHaveLength(0)

    await Bun.sleep(1100)
    expect(s.closed[0]).toEqual({ code: WS_CLOSE_AUTH, reason: 'Token expired' })
    expect(s.data.userId).toBe('')
    expect(s.data.subscribedQueries.size).toBe(0)
  })
})
