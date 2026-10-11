import { z } from 'zod'

// Create query schema
export const createQuerySchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  query: z.string().min(1, 'Query text is required')
})

export type CreateQueryInput = z.infer<typeof createQuerySchema>

// List queries query schema
export const listQueriesQuerySchema = z.object({
  sessionId: z.string().uuid().optional(),
  status: z.enum(['processing', 'completed', 'error', 'cancelled']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0)
})

export type ListQueriesQuery = z.infer<typeof listQueriesQuerySchema>

// Query event types
export type QueryEventType =
  | 'thinking'
  | 'tool_start'
  | 'tool_progress'
  | 'tool_end'
  | 'tool_error'
  | 'tool_limit'
  | 'answer_start'
  | 'done'

// Query event data structures
export interface ThinkingEvent {
  type: 'thinking'
  message: string
}

export interface ToolStartEvent {
  type: 'tool_start'
  tool: string
  args: Record<string, unknown>
}

export interface ToolProgressEvent {
  type: 'tool_progress'
  tool: string
  message: string
}

export interface ToolEndEvent {
  type: 'tool_end'
  tool: string
  args: Record<string, unknown>
  result: string
  duration: number
}

export interface ToolErrorEvent {
  type: 'tool_error'
  tool: string
  error: string
}

export interface ToolLimitEvent {
  type: 'tool_limit'
  tool: string
  message: string
}

export interface AnswerStartEvent {
  type: 'answer_start'
}

export interface DoneEvent {
  type: 'done'
  answer: string
  toolCalls: Array<{
    tool: string
    args: Record<string, unknown>
    result: string
  }>
  iterations: number
  totalTime: number
  tokenUsage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  tokensPerSecond?: number
}

export type QueryEventData =
  | ThinkingEvent
  | ToolStartEvent
  | ToolProgressEvent
  | ToolEndEvent
  | ToolErrorEvent
  | ToolLimitEvent
  | AnswerStartEvent
  | DoneEvent

// Query status type
export type QueryStatus = 'processing' | 'completed' | 'error' | 'cancelled'
