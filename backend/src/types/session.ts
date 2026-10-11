import { z } from 'zod'

// Create session schema
export const createSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required').optional(),
  model: z.string().min(1, 'Model is required'),
  provider: z.string().min(1, 'Provider is required'),
  config: z.record(z.string(), z.unknown()).optional()
})

export type CreateSessionInput = z.infer<typeof createSessionSchema>

// Update session schema
export const updateSessionSchema = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional()
})

export type UpdateSessionInput = z.infer<typeof updateSessionSchema>

// List sessions query schema
export const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  sort: z.enum(['createdAt', 'updatedAt']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc')
})

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>
