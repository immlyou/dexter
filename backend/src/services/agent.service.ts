import { Agent } from '../../../src/agent/agent.js'
import type { AgentEvent } from '../../../src/agent/types.js'
import { addQueryEvent, updateQueryStatus } from './query.service'
import type { QueryEventData } from '../types/query'
import { broadcastQueryEvent } from '../websocket/handler'

// Hard upper bound so a hung LLM/tool call can never leave a query in "processing" forever
const QUERY_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Execute a query using the Agent
 * This function runs asynchronously and updates the database as events occur.
 * It always ends with the query in a terminal state (completed or failed).
 */
export async function executeQuery(
  queryId: string,
  queryText: string,
  config: {
    model: string
    provider: string
    maxIterations?: number
  }
): Promise<void> {
  let finished = false

  try {
    // Create agent instance
    const agent = Agent.create({
      model: config.model,
      modelProvider: config.provider,
      maxIterations: config.maxIterations || 10,
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS)
    })

    // Run agent and process events
    for await (const event of agent.run(queryText)) {
      await handleAgentEvent(queryId, event)
      if (event.type === 'done') finished = true
    }

    if (!finished) {
      throw new Error('Agent finished without producing an answer')
    }
  } catch (error) {
    console.error('Agent execution error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error occurred'

    // Mark the query failed first so the terminal state is never lost
    await updateQueryStatus(queryId, 'error', { errorMessage: message })

    const errorData: QueryEventData = { type: 'tool_error', tool: 'agent', error: message }
    await emitEvent(queryId, errorData)
  }
}

/**
 * Persist an event and broadcast it to subscribed WebSocket clients
 */
async function emitEvent(queryId: string, data: QueryEventData): Promise<void> {
  await addQueryEvent(queryId, data.type, data)
  broadcastQueryEvent(queryId, { type: data.type, data, timestamp: new Date() })
}

/**
 * Handle individual agent events
 */
async function handleAgentEvent(
  queryId: string,
  event: AgentEvent
): Promise<void> {
  switch (event.type) {
    case 'thinking':
      await emitEvent(queryId, { type: 'thinking', message: event.message })
      break

    case 'tool_start':
      await emitEvent(queryId, { type: 'tool_start', tool: event.tool, args: event.args })
      break

    case 'tool_progress':
      await emitEvent(queryId, { type: 'tool_progress', tool: event.tool, message: event.message })
      break

    case 'tool_end':
      await emitEvent(queryId, {
        type: 'tool_end',
        tool: event.tool,
        args: event.args,
        result: event.result,
        duration: event.duration
      })
      break

    case 'tool_error':
      await emitEvent(queryId, { type: 'tool_error', tool: event.tool, error: event.error })
      break

    case 'tool_limit':
      await emitEvent(queryId, {
        type: 'tool_limit',
        tool: event.tool,
        message: event.warning || 'Tool usage limit warning'
      })
      break

    case 'answer_start':
      await emitEvent(queryId, { type: 'answer_start' })
      break

    case 'done':
      // Persist the result before the final event so a client seeing "done" can read the answer
      await updateQueryStatus(queryId, 'completed', {
        answer: event.answer,
        iterations: event.iterations,
        totalTime: event.totalTime,
        tokenUsage: event.tokenUsage || undefined,
        tokensPerSecond: event.tokensPerSecond || undefined
      })
      await emitEvent(queryId, {
        type: 'done',
        answer: event.answer,
        toolCalls: event.toolCalls,
        iterations: event.iterations,
        totalTime: event.totalTime,
        tokenUsage: event.tokenUsage,
        tokensPerSecond: event.tokensPerSecond
      })
      break

    case 'context_cleared':
      // Informational only, not stored
      break

    default:
      console.warn(`Unknown event type for query ${queryId}:`, event)
  }
}

/**
 * Start query execution in the background
 */
export function startQueryExecution(
  queryId: string,
  queryText: string,
  config: {
    model: string
    provider: string
    maxIterations?: number
  }
): void {
  // Execute asynchronously without waiting
  executeQuery(queryId, queryText, config).catch(error => {
    console.error(`Background execution failed for query ${queryId}:`, error)
  })
}
