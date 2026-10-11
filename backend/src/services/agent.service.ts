import { Agent } from '../../../src/agent/agent.js'
import type { AgentEvent } from '../../../src/agent/types.js'
import { addQueryEvent, updateQueryStatus } from './query.service'
import type { QueryEventData } from '../types/query'
import { broadcastQueryEvent } from '../websocket/handler'

/**
 * Execute a query using the Agent
 * This function runs asynchronously and updates the database as events occur
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
  const startTime = Date.now()

  try {
    // Create agent instance
    const agent = Agent.create({
      model: config.model,
      modelProvider: config.provider,
      maxIterations: config.maxIterations || 10
    })

    // Run agent and process events
    const eventStream = agent.run(queryText)

    for await (const event of eventStream) {
      await handleAgentEvent(queryId, event, startTime)
    }
  } catch (error) {
    console.error('Agent execution error:', error)

    // Update query status to error
    await updateQueryStatus(queryId, 'error', {
      errorMessage: error instanceof Error ? error.message : 'Unknown error occurred'
    })

    // Add error event
    await addQueryEvent(queryId, 'tool_error', {
      type: 'tool_error',
      tool: 'agent',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Handle individual agent events
 */
async function handleAgentEvent(
  queryId: string,
  event: AgentEvent,
  startTime: number
): Promise<void> {
  const timestamp = new Date()

  switch (event.type) {
    case 'thinking':
      const thinkingData = {
        type: 'thinking',
        message: event.message
      }
      await addQueryEvent(queryId, 'thinking', thinkingData)
      broadcastQueryEvent(queryId, { type: 'thinking', data: thinkingData, timestamp })
      break

    case 'tool_start':
      const toolStartData = {
        type: 'tool_start',
        tool: event.tool,
        args: event.args
      }
      await addQueryEvent(queryId, 'tool_start', toolStartData)
      broadcastQueryEvent(queryId, { type: 'tool_start', data: toolStartData, timestamp })
      break

    case 'tool_progress':
      const toolProgressData = {
        type: 'tool_progress',
        tool: event.tool,
        message: event.message
      }
      await addQueryEvent(queryId, 'tool_progress', toolProgressData)
      broadcastQueryEvent(queryId, { type: 'tool_progress', data: toolProgressData, timestamp })
      break

    case 'tool_end':
      const toolEndData = {
        type: 'tool_end',
        tool: event.tool,
        args: event.args,
        result: event.result,
        duration: event.duration
      }
      await addQueryEvent(queryId, 'tool_end', toolEndData)
      broadcastQueryEvent(queryId, { type: 'tool_end', data: toolEndData, timestamp })
      break

    case 'tool_error':
      const toolErrorData = {
        type: 'tool_error',
        tool: event.tool,
        error: event.error
      }
      await addQueryEvent(queryId, 'tool_error', toolErrorData)
      broadcastQueryEvent(queryId, { type: 'tool_error', data: toolErrorData, timestamp })
      break

    case 'tool_limit':
      const toolLimitData = {
        type: 'tool_limit',
        tool: event.tool,
        message: event.warning || 'Tool usage limit warning'
      }
      await addQueryEvent(queryId, 'tool_limit', toolLimitData)
      broadcastQueryEvent(queryId, { type: 'tool_limit', data: toolLimitData, timestamp })
      break

    case 'answer_start':
      const answerStartData = {
        type: 'answer_start'
      }
      await addQueryEvent(queryId, 'answer_start', answerStartData)
      broadcastQueryEvent(queryId, { type: 'answer_start', data: answerStartData, timestamp })
      break

    case 'done':
      const doneData = {
        type: 'done',
        answer: event.answer,
        toolCalls: event.toolCalls,
        iterations: event.iterations,
        totalTime: event.totalTime,
        tokenUsage: event.tokenUsage,
        tokensPerSecond: event.tokensPerSecond
      }
      // Add final event
      await addQueryEvent(queryId, 'done', doneData)
      broadcastQueryEvent(queryId, { type: 'done', data: doneData, timestamp })

      // Update query status to completed
      await updateQueryStatus(queryId, 'completed', {
        answer: event.answer,
        iterations: event.iterations,
        totalTime: event.totalTime,
        tokenUsage: event.tokenUsage || undefined,
        tokensPerSecond: event.tokensPerSecond || undefined
      })
      break

    case 'context_cleared':
      // This is an informational event, we can log it but don't need to store it
      console.log(`Context cleared for query ${queryId}: ${event.clearedCount} cleared, ${event.keptCount} kept`)
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
