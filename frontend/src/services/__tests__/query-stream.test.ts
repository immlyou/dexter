import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api';
import wsClient from '../websocket';
import { watchQuery } from '../query-stream';

const observer = { onEvent: vi.fn(), onComplete: vi.fn(), onError: vi.fn() };
const unsubscribe = vi.fn();
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(wsClient, 'subscribe').mockReturnValue(unsubscribe);
  vi.spyOn(apiClient, 'getQuery').mockResolvedValue({ queryId: 'query-1', sessionId: 'session-1', queryText: 'Question', status: 'processing', createdAt: '' });
});

afterEach(() => {
  stop?.();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('times out after the backend deadline and cleans up all timers', async () => {
  stop = watchQuery('query-1', observer);
  await vi.advanceTimersByTimeAsync(60000);
  expect(observer.onError).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(545000);
  expect(observer.onError).toHaveBeenCalledWith('查詢超時，請重試');
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('ignores an in-flight REST result after cleanup', async () => {
  let resolveQuery!: (query: Awaited<ReturnType<typeof apiClient.getQuery>>) => void;
  vi.mocked(apiClient.getQuery).mockReturnValue(new Promise((resolve) => { resolveQuery = resolve; }));
  stop = watchQuery('query-1', observer);
  stop();
  resolveQuery({ queryId: 'query-1', sessionId: 'session-1', queryText: 'Question', status: 'completed', answer: 'Stale answer', createdAt: '' });
  await vi.advanceTimersByTimeAsync(0);
  expect(observer.onComplete).not.toHaveBeenCalled();
});

it('falls back to REST if socket construction fails and retries a transient HTTP failure', async () => {
  vi.mocked(wsClient.subscribe).mockImplementation(() => { throw new Error('Socket unavailable'); });
  vi.mocked(apiClient.getQuery).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce({ queryId: 'query-1', sessionId: 'session-1', queryText: 'Question', status: 'completed', answer: 'Recovered', createdAt: '' });
  stop = watchQuery('query-1', observer);
  await vi.advanceTimersByTimeAsync(2000);
  expect(observer.onComplete).toHaveBeenCalledWith('Recovered');
  expect(observer.onError).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('stops on a cancelled query', async () => {
  vi.mocked(apiClient.getQuery).mockResolvedValue({ queryId: 'query-1', sessionId: 'session-1', queryText: 'Question', status: 'cancelled', createdAt: '' });
  stop = watchQuery('query-1', observer);
  await vi.advanceTimersByTimeAsync(0);
  expect(observer.onError).toHaveBeenCalledWith('查詢已取消');
  expect(unsubscribe).toHaveBeenCalledOnce();
});
