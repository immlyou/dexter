import { z } from 'zod'
import { providerSchema, modelSchema, isAllowedModel, MAX_ITERATIONS_LIMIT } from '../config/models'

// Session config: only known keys, bounded values
export const sessionConfigSchema = z.object({
  maxIterations: z.number().int().min(1).max(MAX_ITERATIONS_LIMIT).optional()
}).strict()

const modelMatchesProvider = (data: { model?: string; provider?: string }) =>
  (data.model === undefined) === (data.provider === undefined) &&
  (data.model === undefined || isAllowedModel(data.provider!, data.model))

const modelMismatch = {
  message: 'model and provider must be supplied together and the model must belong to the provider',
  path: ['model']
}

// Create session schema
export const createSessionSchema = z.object({
  name: z.string().min(1, 'Session name is required').max(200).optional(),
  model: modelSchema,
  provider: providerSchema,
  config: sessionConfigSchema.optional()
}).refine(modelMatchesProvider, modelMismatch)

export type CreateSessionInput = z.infer<typeof createSessionSchema>

// Update session schema
export const updateSessionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  model: modelSchema.optional(),
  provider: providerSchema.optional(),
  config: sessionConfigSchema.optional()
}).refine(modelMatchesProvider, modelMismatch)

export type UpdateSessionInput = z.infer<typeof updateSessionSchema>

// List sessions query schema
export const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  sort: z.enum(['createdAt', 'updatedAt']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc')
})

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>
