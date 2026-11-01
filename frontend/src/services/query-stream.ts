import type { AgentEvent } from '../types';
import apiClient from './api';
import wsClient from './websocket';

interface QueryObserver {
  onEvent: (event: AgentEvent) => void;
  onComplete: (answer: string) => void;
  onError: (message: string) => void;
}

export function watchQuery(queryId: string, observer: QueryObserver): () => void {
  let stopped = false;
  let polling = false;
  let unsubscribe: (() => void) | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(pollInterval);
    clearTimeout(timeout);
    unsubscribe?.();
  };

  const complete = (answer: string) => {
    if (stopped) return;
    stop();
    observer.onComplete(answer);
  };

  const fail = (message: string) => {
    if (stopped) return;
    stop();
    observer.onError(message);
  };

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const query = await apiClient.getQuery(queryId);
      if (query.status === 'completed') complete(query.answer || '無回答');
      else if (query.status === 'error') fail(query.errorMessage || '未知錯誤');
      else if (query.status === 'cancelled') fail('查詢已取消');
    } catch {
      // Transient transport failures are retried until the overall deadline.
    } finally {
      polling = false;
    }
  };

  // Keep checking terminal status even after live events, including after reconnects.
  const pollInterval = setInterval(() => void poll(), 2000);
  const timeout = setTimeout(() => fail('查詢超時，請重試'), 10 * 60 * 1000 + 5000);

  try {
    unsubscribe = wsClient.subscribe(queryId, (event) => {
      if (stopped) return;
      observer.onEvent(event);
      if (event.type === 'done') complete(event.answer);
      else if (event.type === 'tool_error' && event.tool === 'agent') fail(event.error);
    }, () => void poll());
  } catch {
    // REST remains available when the WebSocket cannot connect.
  }
  void poll();
  return stop;
}
