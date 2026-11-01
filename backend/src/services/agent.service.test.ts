import { describe, test, expect } from 'bun:test'
import type { AgentEvent } from '../../../src/agent/types.js'
import { executeQuery, abortQueryExecution, type ExecuteQueryDeps } from './agent.service'
import type { QueryStatus } from '../types/query'

const config = { model: 'claude-sonnet-5-5', provider: 'anthropic' }

function harness(agentRun: (signal: AbortSignal) => AsyncGenerator<AgentEvent>, timeoutMs = 30) {
  const statuses: Array<{ status: QueryStatus; errorMessage?: string }> = []
  const events: string[] = []
  let signal: AbortSignal | undefined
  let releases = 0
  const deps: Partial<ExecuteQueryDeps> = {
    timeoutMs,
    createAgent: (options) => {
      signal = options?.signal
      return { run: () => agentRun(options!.signal!) } as unknown as ReturnType<ExecuteQueryDeps['createAgent']>
    },
    updateQueryStatus: async (_id, status, data) => {
      // Mirrors the DB guard: only the first terminal transition applies
      if (statuses.length) return false
      statuses.push({ status, errorMessage: data?.errorMessage })
      return true
    },
    emitEvent: async (_id, data) => {
      events.push(data.type)
    }
  }
  return {
    deps,
    statuses,
    events,
    onSettled: () => { releases++ },
    get releases() { return releases },
    get signal() { return signal }
  }
}

const never = () => new Promise<never>(() => {})

describe('query execution hard timeout', () => {
  test('a hung agent that ignores abort is failed and its slot released exactly once', async () => {
    const h = harness(async function* () {
      await never()
    })
    const started = Date.now()
    await executeQuery('q1', 'hello', config, h.onSettled, h.deps)

    expect(Date.now() - started).toBeLessThan(1000)
    expect(h.releases).toBe(1)
    expect(h.signal?.aborted).toBe(true)
    expect(h.statuses).toEqual([{ status: 'error', errorMessage: expect.stringContaining('timed out') }])
    expect(h.events).toEqual(['tool_error'])
  })

  test('slot is released even if marking the timeout in the DB hangs', async () => {
    const h = harness(async function* () {
      await never()
    })
    let released = false
    void executeQuery('q2', 'hello', config, () => { released = true }, { ...h.deps, updateQueryStatus: never })
    await new Promise((r) => setTimeout(r, 80))
    expect(released).toBe(true)
  })

  for (const hanging of ['status', 'event'] as const) {
    test('deadline releases once when ordinary error ' + hanging + ' persistence hangs', async () => {
      const h = harness(async function* () { throw new Error('early failure') })
      const overrides = hanging === 'status' ? { updateQueryStatus: never } : { emitEvent: never }
      void executeQuery('error-' + hanging, 'hello', config, h.onSettled, { ...h.deps, ...overrides })
      await new Promise(r => setTimeout(r, 80))
      expect(h.releases).toBe(1)
      expect(h.signal?.aborted).toBe(true)
    })
  }

  test('events produced after the timeout are not recorded', async () => {
    let resume!: () => void
    const h = harness(async function* () {
      await new Promise<void>((r) => { resume = r })
      yield { type: 'thinking', message: 'late' } as AgentEvent
    })
    await executeQuery('q3', 'hello', config, h.onSettled, h.deps)
    resume()
    await new Promise((r) => setTimeout(r, 10))
    expect(h.events).toEqual(['tool_error'])
    expect(h.releases).toBe(1)
  })

  test('agent errors mark the query failed and release once', async () => {
    const h = harness(async function* () {
      throw new Error('LLM exploded')
    }, 1000)
    await executeQuery('q4', 'hello', config, h.onSettled, h.deps)
    expect(h.statuses).toEqual([{ status: 'error', errorMessage: 'LLM exploded' }])
    expect(h.releases).toBe(1)
  })

  test('user cancellation records nothing and releases once', async () => {
    const h = harness(async function* (signal) {
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    }, 1000)
    const run = executeQuery('q5', 'hello', config, h.onSettled, h.deps)
    await new Promise((r) => setTimeout(r, 5))
    abortQueryExecution('q5')
    await run
    expect(h.statuses).toEqual([])
    expect(h.releases).toBe(1)
  })
})

describe('web agent configuration', () => {
  test('agents are created for the web channel with memory disabled and the run signal', async () => {
    let options: Parameters<ExecuteQueryDeps['createAgent']>[0] | undefined
    // An agent that yields nothing keeps the run on the injected (DB-free) collaborators
    const h = harness(async function* () {}, 1000)
    await executeQuery('q-web', 'hello', config, h.onSettled, {
      ...h.deps,
      createAgent: (o) => {
        options = o
        return h.deps.createAgent!(o)
      }
    })

    expect(options).toMatchObject({ channel: 'web', memoryEnabled: false, model: config.model })
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(process.env.DEXTER_WEB_MODE).toBe('1')
  })
})
