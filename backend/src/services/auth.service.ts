import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { db } from '../db/client'
import { users, type User } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getAuthSecrets } from '../config/secrets'
import { drizzleRefreshTokenRepo, type RefreshTokenRepo } from './refreshToken.repo'

// Environment configuration
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '30d'
const BCRYPT_ROUNDS = 10

const ISSUER = 'dexter-api'
// Distinct audiences so one token type can never be replayed as the other
export const ACCESS_AUDIENCE = 'dexter-client'
export const REFRESH_AUDIENCE = 'dexter-refresh'

// JWT Payload interface (access tokens)
export interface JWTPayload {
  userId: string
  email: string
  plan: string
}

export interface AccessTokenClaims extends JWTPayload {
  typ: 'access'
  exp: number
}

export interface RefreshTokenClaims {
  userId: string
  typ: 'refresh'
  jti: string
  exp: number
}

// Token response interface
export interface TokenPair {
  accessToken: string
  refreshToken: string
}

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

/**
 * Compare a password with a hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * SHA-256 hex digest of a full token (tokens are high-entropy, so a fast hash is sufficient)
 */
export function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function digestsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/**
 * Generate an access token (JWT)
 */
export function generateAccessToken(payload: JWTPayload): string {
  const { userId, email, plan } = payload
  return jwt.sign({ userId, email, plan, typ: 'access' }, getAuthSecrets().accessSecret, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN,
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE
  } as jwt.SignOptions)
}

/**
 * Generate a refresh token with a fresh random jti
 */
export function generateRefreshToken(userId: string): { token: string; jti: string; expiresAt: Date } {
  const jti = randomUUID()
  const token = jwt.sign({ userId, typ: 'refresh' }, getAuthSecrets().refreshSecret, {
    algorithm: 'HS256',
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    issuer: ISSUER,
    audience: REFRESH_AUDIENCE,
    jwtid: jti
  } as jwt.SignOptions)
  const { exp } = jwt.decode(token) as { exp: number }
  return { token, jti, expiresAt: new Date(exp * 1000) }
}

function mapJwtError(error: unknown): Error {
  if (error instanceof jwt.TokenExpiredError) return new Error('TOKEN_EXPIRED')
  if (error instanceof jwt.JsonWebTokenError) return new Error('TOKEN_INVALID')
  return new Error('TOKEN_VERIFICATION_FAILED')
}

/**
 * Verify an access token. Refresh tokens (other secret/audience/typ) are rejected.
 */
export function verifyAccessToken(token: string): AccessTokenClaims {
  let decoded: jwt.JwtPayload
  try {
    decoded = jwt.verify(token, getAuthSecrets().accessSecret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: ACCESS_AUDIENCE
    }) as jwt.JwtPayload
  } catch (error) {
    throw mapJwtError(error)
  }
  if (decoded.typ !== 'access' || typeof decoded.userId !== 'string' || typeof decoded.exp !== 'number') {
    throw new Error('TOKEN_INVALID')
  }
  return decoded as AccessTokenClaims
}

/**
 * Verify a refresh token. Access tokens are rejected.
 */
export function verifyRefreshToken(token: string): RefreshTokenClaims {
  let decoded: jwt.JwtPayload
  try {
    decoded = jwt.verify(token, getAuthSecrets().refreshSecret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: REFRESH_AUDIENCE
    }) as jwt.JwtPayload
  } catch (error) {
    throw mapJwtError(error)
  }
  if (decoded.typ !== 'refresh' || typeof decoded.userId !== 'string' || typeof decoded.jti !== 'string' || typeof decoded.exp !== 'number') {
    throw new Error('TOKEN_INVALID')
  }
  return decoded as RefreshTokenClaims
}

async function persistRefreshToken(repo: RefreshTokenRepo, userId: string, refresh: { token: string; jti: string; expiresAt: Date }) {
  await repo.insert({
    userId,
    jti: refresh.jti,
    tokenHash: digestToken(refresh.token),
    expiresAt: refresh.expiresAt
  })
}

/**
 * Issue an access/refresh pair and persist the refresh token's digest.
 * Runs under the per-user lock so it is ordered against rotation and revoke-all.
 */
export async function issueTokens(user: User, repo: RefreshTokenRepo = drizzleRefreshTokenRepo): Promise<TokenPair> {
  return repo.transaction(async (tx) => {
    await tx.lockUser(user.id)
    const accessToken = generateAccessToken({ userId: user.id, email: user.email, plan: user.plan })
    const refresh = generateRefreshToken(user.id)
    await persistRefreshToken(tx, user.id, refresh)
    return { accessToken, refreshToken: refresh.token }
  })
}

/**
 * Register a new user
 */
export async function registerUser(email: string, password: string, name?: string): Promise<{ user: User; tokens: TokenPair }> {
  // Check if user already exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email)
  })

  if (existingUser) {
    throw new Error('USER_ALREADY_EXISTS')
  }

  // Hash password
  const passwordHash = await hashPassword(password)

  // Create user
  const result = await db.insert(users).values({
    email,
    passwordHash,
    name,
    plan: 'free'
  }).returning()

  const newUser = result[0]
  if (!newUser) {
    throw new Error('USER_CREATION_FAILED')
  }

  return { user: newUser, tokens: await issueTokens(newUser) }
}

/**
 * Login a user
 */
export async function loginUser(email: string, password: string): Promise<{ user: User; tokens: TokenPair }> {
  // Find user by email
  const user = await db.query.users.findFirst({
    where: eq(users.email, email)
  })

  if (!user) {
    throw new Error('INVALID_CREDENTIALS')
  }

  // Compare password before revealing account state
  const isValidPassword = await comparePassword(password, user.passwordHash)
  if (!isValidPassword) {
    throw new Error('INVALID_CREDENTIALS')
  }

  if (!user.isActive) {
    throw new Error('USER_INACTIVE')
  }

  return { user, tokens: await issueTokens(user) }
}

type RotationOutcome =
  | { kind: 'ok'; tokens: TokenPair }
  | { kind: 'reuse' }
  | { kind: 'invalid' }
  | { kind: 'inactive' }

/**
 * Rotate a refresh token atomically.
 * - The user's row is locked first, so rotation, issuance and revoke-all for one user
 *   are serialized (a revoke-all cannot miss a token issued concurrently).
 * - The old token is revoked with a conditional UPDATE so two concurrent refreshes
 *   cannot both succeed.
 * - Every replay of a revoked token revokes all tokens for that user. Cross-tab
 *   coordination belongs exclusively on the client; there is no reuse grace window.
 * - The user is reloaded so deactivation and plan changes take effect immediately.
 */
export async function refreshAccessToken(
  refreshToken: string,
  repo: RefreshTokenRepo = drizzleRefreshTokenRepo,
  now: () => number = Date.now
): Promise<TokenPair> {
  const claims = verifyRefreshToken(refreshToken)
  const tokenHash = digestToken(refreshToken)

  const outcome = await repo.transaction<RotationOutcome>(async (tx) => {
    const user = await tx.lockUser(claims.userId)
    if (!user) return { kind: 'invalid' }

    const successor = generateRefreshToken(user.id)
    const revoked = await tx.revokeActive(claims.jti, tokenHash, successor.jti)

    if (!revoked) {
      const existing = await tx.findByJti(claims.jti)
      if (!existing || !existing.isRevoked || existing.userId !== user.id || !digestsEqual(existing.tokenHash, tokenHash)) {
        return { kind: 'invalid' }
      }
      await tx.revokeAllForUser(user.id)
      return { kind: 'reuse' }
    }

    if (revoked.userId !== user.id || revoked.expiresAt.getTime() <= now()) {
      return { kind: 'invalid' }
    }

    if (!user.isActive) {
      await tx.revokeAllForUser(user.id)
      return { kind: 'inactive' }
    }

    await persistRefreshToken(tx, user.id, successor)
    const accessToken = generateAccessToken({ userId: user.id, email: user.email, plan: user.plan })
    return { kind: 'ok', tokens: { accessToken, refreshToken: successor.token } }
  })

  switch (outcome.kind) {
    case 'ok':
      return outcome.tokens
    case 'reuse':
      throw new Error('REFRESH_TOKEN_REUSED')
    case 'inactive':
      throw new Error('USER_INACTIVE')
    default:
      throw new Error('INVALID_REFRESH_TOKEN')
  }
}

/**
 * Delete only expired refresh tokens. expiresAt derives from REFRESH_TOKEN_EXPIRES_IN
 * at issuance, so even a later config change cannot shorten replay evidence retention.
 */
export async function cleanupRefreshTokens(
  repo: RefreshTokenRepo = drizzleRefreshTokenRepo,
  now: Date = new Date()
): Promise<number> {
  return repo.deleteStale(now)
}

/**
 * Run cleanupRefreshTokens periodically. The timer is unref'd so it never keeps the
 * process alive; returns a stop function.
 */
export function startRefreshTokenCleanup(
  intervalMs = 60 * 60 * 1000,
  cleanup: () => Promise<number> = () => cleanupRefreshTokens()
): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await cleanup()
    } catch (error) {
      console.error('Refresh token cleanup failed:', error)
    } finally {
      running = false
    }
  }
  void tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}

/**
 * Logout user by revoking refresh token
 */
export async function logoutUser(
  refreshToken: string,
  repo: RefreshTokenRepo = drizzleRefreshTokenRepo
): Promise<void> {
  const claims = verifyRefreshToken(refreshToken)
  await repo.transaction(async (tx) => {
    await tx.lockUser(claims.userId)
    const row = await tx.findByJti(claims.jti)
    if (!row || row.userId !== claims.userId || !digestsEqual(row.tokenHash, digestToken(refreshToken))) return
    // Logging out with a rotated credential is also replay: kill its successors.
    if (row.isRevoked) await tx.revokeAllForUser(claims.userId)
    else await tx.revokeActive(claims.jti, row.tokenHash)
  })
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.id, userId)
  })
}
