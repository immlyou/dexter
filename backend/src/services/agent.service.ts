import { Agent } from '../../../src/agent/agent.js'
import type { AgentEvent } from '../../../src/agent/types.js'
import { addQueryEvent, updateQueryStatus } from './query.service'
import type { QueryEventData } from '../types/query'
import { broadcastQueryEvent } from '../websocket/handler'
import { clampMaxIterations } from '../config/models'

// Agents run on behalf of untrusted web users: disable tools that can reach arbitrary
// URLs (the root tool registry skips the browser tool in web mode). Read lazily at Agent.create.
process.env.DEXTER_WEB_MODE = '1'

function envMs(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Hard upper bound so a hung LLM/tool call can never leave a query in "processing" forever
// or hold its concurrency slot: enforced with a timer even if the agent ignores the abort.
const QUERY_TIMEOUT_MS = envMs('QUERY_TIMEOUT_MS', 10 * 60 * 1000)

// Per-query abort controllers so a cancel request can stop the running agent
const runningQueries = new Map<string, AbortController>()

/**
 * Abort the agent running for a query (no-op if none is running)
 */
export function abortQueryExecution(queryId: string): void {
  runningQueries.get(queryId)?.abort(new Error('Query cancelled'))
}

type AgentRunner = Pick<Agent, 'run'>

/** Collaborators of executeQuery, injectable for tests. */
export interface ExecuteQueryDeps {
  timeoutMs: number
  createAgent: (options: Parameters<typeof Agent.create>[0]) => AgentRunner
  updateQueryStatus: typeof updateQueryStatus
  emitEvent: (queryId: string, data: QueryEventData) => Promise<void>
}

const defaultDeps: ExecuteQueryDeps = {
  timeoutMs: QUERY_TIMEOUT_MS,
  createAgent: (options) => Agent.create(options),
  updateQueryStatus,
  emitEvent: (queryId, data) => emitEvent(queryId, data)
}

class QueryTimeoutError extends Error {}

/**
 * Execute a query using the Agent
 * This function runs asynchronously and updates the database as events occur.
 * Terminal-state persistence is best effort when the database is unavailable.
 * Independently, `onSettled` (releasing the concurrency slot) runs exactly once, at the latest
 * when the hard timeout fires.
 */
export async function executeQuery(
  queryId: string,
  queryText: string,
  config: {
    model: string
    provider: string
    maxIterations?: number
  },
  onSettled?: () => void,
  overrides: Partial<ExecuteQueryDeps> = {}
): Promise<void> {
  const deps = { ...defaultDeps, ...overrides }
  let finished = false
  let stopped = false
  const controller = new AbortController()
  runningQueries.set(queryId, controller)

  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    if (runningQueries.get(queryId) === controller) runningQueries.delete(queryId)
    onSettled?.()
  }

  const run = async () => {
    const agent = deps.createAgent({
      model: config.model,
      modelProvider: config.provider,
      maxIterations: clampMaxIterations(config.maxIterations),
      signal: controller.signal
    })

    for await (const event of agent.run(queryText)) {
      // After a cancel or timeout, late events must not be recorded
      if (controller.signal.aborted || stopped) return
      await handleAgentEvent(queryId, event)
      if (event.type === 'done') finished = true
    }

    if (!finished && !controller.signal.aborted && !stopped) {
      throw new Error('Agent finished without producing an answer')
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new QueryTimeoutError(`Query timed out after ${Math.round(deps.timeoutMs / 1000)}s`)
      stopped = true
      controller.abort(error)
      // Independent of Promise.race: error persistence/event delivery may also hang.
      settle()
      reject(error)
    }, deps.timeoutMs)
  })
  const execution = run()

  try {
    await Promise.race([execution, timeout])
  } catch (error) {
    stopped = true
    if (error instanceof QueryTimeoutError) {
      controller.abort(error)
      // Abort is cooperative: in-flight provider work may continue after slot release.
      // Cancellation of an unresponsive agent is bounded by this same deadline.
      execution.catch(() => {})
      settle()
    } else if (controller.signal.aborted) {
      // Cancelled by the user: status is already 'cancelled', nothing more to record
      return
    } else {
      console.error('Agent execution error:', error)
    }

    const message = error instanceof Error ? error.message : 'Unknown error occurred'

    // Mark the query failed first so the terminal state is never lost
    // (a no-op if it already left 'processing', e.g. cancelled meanwhile)
    if (await deps.updateQueryStatus(queryId, 'error', { errorMessage: message })) {
      const errorData: QueryEventData = { type: 'tool_error', tool: 'agent', error: message }
      await deps.emitEvent(queryId, errorData)
    }
  } finally {
    clearTimeout(timer)
    settle()
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
  },
  onSettled?: () => void
): void {
  // Execute asynchronously without waiting; onSettled runs exactly when execution ends
  executeQuery(queryId, queryText, config, onSettled).catch(error => {
    console.error(`Background execution failed for query ${queryId}:`, error)
  })
}
