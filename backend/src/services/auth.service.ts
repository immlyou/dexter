import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { db } from '../db/client'
import { users, refreshTokens, type User, type NewUser } from '../db/schema'
import { eq } from 'drizzle-orm'
import { getAuthSecrets } from '../config/secrets'

// Environment configuration
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m'
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '30d'
const BCRYPT_ROUNDS = 10

// JWT Payload interface
export interface JWTPayload {
  userId: string
  email: string
  plan: string
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
 * Generate an access token (JWT)
 */
export function generateAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, getAuthSecrets().accessSecret, {
    expiresIn: JWT_EXPIRES_IN as string | number,
    issuer: 'dexter-api',
    audience: 'dexter-client'
  } as jwt.SignOptions)
}

/**
 * Generate a refresh token
 */
export function generateRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, getAuthSecrets().accessSecret, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN as string | number,
    issuer: 'dexter-api',
    audience: 'dexter-client'
  } as jwt.SignOptions)
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, getAuthSecrets().accessSecret, {
      issuer: 'dexter-api',
      audience: 'dexter-client'
    }) as JWTPayload
    return decoded
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('TOKEN_EXPIRED')
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('TOKEN_INVALID')
    }
    throw new Error('TOKEN_VERIFICATION_FAILED')
  }
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

  // Generate tokens
  const payload: JWTPayload = {
    userId: newUser.id,
    email: newUser.email,
    plan: newUser.plan
  }

  const accessToken = generateAccessToken(payload)
  const refreshToken = generateRefreshToken(payload)

  // Store refresh token hash in database
  const refreshTokenHash = await hashPassword(refreshToken)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30) // 30 days

  await db.insert(refreshTokens).values({
    userId: newUser.id,
    tokenHash: refreshTokenHash,
    expiresAt
  })

  return {
    user: newUser,
    tokens: {
      accessToken,
      refreshToken
    }
  }
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

  // Check if user is active
  if (!user.isActive) {
    throw new Error('USER_INACTIVE')
  }

  // Compare password
  const isValidPassword = await comparePassword(password, user.passwordHash)
  if (!isValidPassword) {
    throw new Error('INVALID_CREDENTIALS')
  }

  // Generate tokens
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    plan: user.plan
  }

  const accessToken = generateAccessToken(payload)
  const refreshToken = generateRefreshToken(payload)

  // Store refresh token hash in database
  const refreshTokenHash = await hashPassword(refreshToken)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30) // 30 days

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: refreshTokenHash,
    expiresAt
  })

  return {
    user,
    tokens: {
      accessToken,
      refreshToken
    }
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  // Verify refresh token
  const payload = verifyToken(refreshToken)

  // Check if refresh token exists in database and is not revoked
  const storedTokens = await db.query.refreshTokens.findMany({
    where: eq(refreshTokens.userId, payload.userId)
  })

  // Find matching token (compare hashes)
  let validToken = null
  for (const token of storedTokens) {
    if (!token.isRevoked) {
      const isMatch = await comparePassword(refreshToken, token.tokenHash)
      if (isMatch) {
        validToken = token
        break
      }
    }
  }

  if (!validToken) {
    throw new Error('INVALID_REFRESH_TOKEN')
  }

  // Check if token is expired
  if (new Date() > validToken.expiresAt) {
    throw new Error('REFRESH_TOKEN_EXPIRED')
  }

  // Extract only user data (remove JWT metadata like exp, iat, aud, iss)
  const userData = {
    userId: payload.userId,
    email: payload.email,
    plan: payload.plan
  }

  // Generate new tokens
  const newAccessToken = generateAccessToken(userData)
  const newRefreshToken = generateRefreshToken(userData)

  // Store new refresh token
  const newRefreshTokenHash = await hashPassword(newRefreshToken)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  await db.insert(refreshTokens).values({
    userId: payload.userId,
    tokenHash: newRefreshTokenHash,
    expiresAt
  })

  // Revoke old refresh token
  await db.update(refreshTokens)
    .set({ isRevoked: true })
    .where(eq(refreshTokens.id, validToken.id))

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken
  }
}

/**
 * Logout user by revoking refresh token
 */
export async function logoutUser(refreshToken: string): Promise<void> {
  // Verify refresh token
  const payload = verifyToken(refreshToken)

  // Find and revoke the token
  const storedTokens = await db.query.refreshTokens.findMany({
    where: eq(refreshTokens.userId, payload.userId)
  })

  for (const token of storedTokens) {
    if (!token.isRevoked) {
      const isMatch = await comparePassword(refreshToken, token.tokenHash)
      if (isMatch) {
        await db.update(refreshTokens)
          .set({ isRevoked: true })
          .where(eq(refreshTokens.id, token.id))
        break
      }
    }
  }
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | undefined> {
  return db.query.users.findFirst({
    where: eq(users.id, userId)
  })
}
