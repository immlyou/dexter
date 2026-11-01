import { z } from 'zod'

// Registration schema
export const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional()
})

export type RegisterInput = z.infer<typeof registerSchema>

// Login schema
export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required')
})

export type LoginInput = z.infer<typeof loginSchema>

// Refresh token schema
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
})

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>

// Logout schema
export const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required')
})

export type LogoutInput = z.infer<typeof logoutSchema>
