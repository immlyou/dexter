import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import App from './App';
import { server } from './test/mocks/server';
import wsClient from './services/websocket';

class TestWebSocket {
  static OPEN = 1;
  static instances: TestWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();

  constructor() {
    TestWebSocket.instances.push(this);
  }

  open() {
    this.readyState = TestWebSocket.OPEN;
    this.onopen?.();
    this.receive({ type: 'authenticated', userId: 'user-1' });
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  event(data: { type: string; [key: string]: unknown }, queryId = 'query-1') {
    this.receive({ type: 'event', queryId, event: { type: data.type, data }, timestamp: new Date().toISOString() });
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '' });
  }
}

const done = { type: 'done', answer: 'Verified research answer', toolCalls: [], iterations: 1, totalTime: 123 };

async function submitQuery() {
  const view = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '創建 Session' }));
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Summarize revenue' } });
  fireEvent.click(screen.getByRole('button', { name: '提交查詢' }));
  await waitFor(() => expect(TestWebSocket.instances).toHaveLength(1));
  const socket = TestWebSocket.instances[0];
  act(() => socket.open());
  return { ...view, socket };
}

beforeEach(() => {
  localStorage.setItem('access_token', 'test-token');
  TestWebSocket.instances = [];
  vi.stubGlobal('WebSocket', TestWebSocket);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  server.use(http.get('http://localhost:3000/api/queries/:id', () => HttpResponse.json({ status: 'processing' })));
});

afterEach(() => {
  wsClient.disconnect();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('login gate', () => {
  it('shows the login form once the session has been cleared', () => {
    localStorage.clear();
    render(<App />);
    expect(screen.queryByRole('button', { name: '創建 Session' })).toBeNull();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });
});

describe('query submission and live results', () => {
  it('authenticates, subscribes and renders backend event envelopes and the answer', async () => {
    const { socket } = await submitQuery();
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'authenticate', token: 'test-token' }));
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe', queryId: 'query-1' }));
    act(() => socket.event({ type: 'thinking', message: 'Analyzing revenue' }));
    expect(screen.getByText('Analyzing revenue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查詢中...' })).toBeDisabled();
    act(() => socket.event(done));
    expect(screen.getByText(done.answer)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交查詢' })).toBeEnabled();
    expect(socket.readyState).toBe(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a terminal agent error and releases the loading state', async () => {
    const { socket } = await submitQuery();
    act(() => socket.event({ type: 'tool_error', tool: 'agent', error: 'Provider unavailable' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Provider unavailable');
    expect(screen.getByRole('button', { name: '提交查詢' })).toBeEnabled();
    expect(screen.queryByText(/✅ 已完成/)).not.toBeInTheDocument();
  });

  it('keeps running after a recoverable tool error', async () => {
    const { socket } = await submitQuery();
    act(() => socket.event({ type: 'tool_error', tool: 'web_search', error: 'Temporary search failure' }));
    expect(screen.getByRole('button', { name: '查詢中...' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => socket.event(done));
    expect(screen.getByText(done.answer)).toBeInTheDocument();
  });

  it('polls for the answer even after an earlier event when the final event is missed', async () => {
    const { socket } = await submitQuery();
    act(() => socket.event({ type: 'thinking', message: 'Working' }));
    server.use(http.get('http://localhost:3000/api/queries/:id', () => HttpResponse.json({ status: 'completed', answer: 'Recovered answer' })));
    expect(await screen.findByText('Recovered answer', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交查詢' })).toBeEnabled();
  });

  it('recovers an error that happened before the subscription', async () => {
    server.use(http.get('http://localhost:3000/api/queries/:id', () => HttpResponse.json({ status: 'error', errorMessage: 'Early failure' })));
    await submitQuery();
    expect(await screen.findByRole('alert')).toHaveTextContent('Early failure');
    expect(screen.getByRole('button', { name: '提交查詢' })).toBeEnabled();
  });

  it('uses REST after a WebSocket authentication or transport error', async () => {
    const { socket } = await submitQuery();
    server.use(http.get('http://localhost:3000/api/queries/:id', () => HttpResponse.json({ status: 'completed', answer: 'REST answer' })));
    act(() => socket.receive({ type: 'error', error: { code: 'AUTH_FAILED', message: 'Socket expired' } }));
    expect(await screen.findByText('REST answer', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('resubscribes to active queries after a reconnect', async () => {
    const { socket } = await submitQuery();
    act(() => socket.close());
    await waitFor(() => expect(TestWebSocket.instances).toHaveLength(2), { timeout: 2500 });
    const reconnected = TestWebSocket.instances[1];
    act(() => reconnected.open());
    expect(reconnected.send).toHaveBeenCalledWith(JSON.stringify({ type: 'subscribe', queryId: 'query-1' }));
    act(() => reconnected.event(done));
    expect(screen.getByText(done.answer)).toBeInTheDocument();
  });

  it('ignores another query and stops the subscription on unmount', async () => {
    const { socket, unmount } = await submitQuery();
    act(() => socket.event(done, 'other-query'));
    expect(screen.queryByText(done.answer)).not.toBeInTheDocument();
    unmount();
    expect(socket.readyState).toBe(3);
    expect(socket.onclose).toBeNull();
  });

  it('shows query creation failures without opening a socket', async () => {
    server.use(http.post('http://localhost:3000/api/queries', () => HttpResponse.json({ error: { message: 'Cannot create query' } }, { status: 500 })));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '創建 Session' }));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Question' } });
    fireEvent.click(screen.getByRole('button', { name: '提交查詢' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot create query');
    expect(TestWebSocket.instances).toHaveLength(0);
  });
});
