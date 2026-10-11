import type { AgentEvent } from '../types';

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:8000';

export type WebSocketEventHandler = (event: AgentEvent) => void;
export type WebSocketErrorHandler = (error: { code: string; message: string }) => void;

interface WSEventMessage {
  type: 'event';
  queryId?: string;
  event: AgentEvent;
  timestamp: string;
}

interface WSErrorMessage {
  type: 'error';
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

interface WSAuthenticatedMessage {
  type: 'authenticated';
  userId: string;
}

interface WSSubscribedMessage {
  type: 'subscribed';
  queryId: string;
}

interface WSUnsubscribedMessage {
  type: 'unsubscribed';
  queryId: string;
}

type WSMessage = WSEventMessage | WSErrorMessage | WSAuthenticatedMessage | WSSubscribedMessage | WSUnsubscribedMessage;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private eventHandlers: Map<string, WebSocketEventHandler[]> = new Map();
  private errorHandlers: Map<string, WebSocketErrorHandler[]> = new Map();
  private isConnecting = false;
  private isAuthenticated = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pendingSubscriptions: string[] = [];

  constructor() {
    // Initialize connection when first subscription is made
  }

  private getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  private connect(): WebSocket {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws;
    }

    if (this.isConnecting && this.ws) {
      return this.ws;
    }

    this.isConnecting = true;

    const token = this.getToken();
    if (!token) {
      throw new Error('Authentication token not found');
    }

    // Connect to /stream endpoint
    const wsUrl = `${WS_BASE_URL}/stream`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.isConnecting = false;
      this.reconnectAttempts = 0;

      // Authenticate
      this.send({
        type: 'authenticate',
        token,
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const data: WSMessage = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      this.isAuthenticated = false;
      this.isConnecting = false;

      // Attempt to reconnect
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connect(), delay);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.isConnecting = false;
    };

    return this.ws;
  }

  private handleMessage(data: WSMessage): void {
    switch (data.type) {
      case 'authenticated':
        console.log('WebSocket authenticated:', data.userId);
        this.isAuthenticated = true;

        // Subscribe to pending queries
        this.pendingSubscriptions.forEach((queryId) => {
          this.send({
            type: 'subscribe',
            queryId,
          });
        });
        this.pendingSubscriptions = [];
        break;

      case 'subscribed':
        console.log('Subscribed to query:', data.queryId);
        break;

      case 'unsubscribed':
        console.log('Unsubscribed from query:', data.queryId);
        break;

      case 'event':
        if (data.queryId) {
          const handlers = this.eventHandlers.get(data.queryId);
          if (handlers) {
            handlers.forEach((handler) => handler(data.event));
          }
        }
        break;

      case 'error':
        console.error('WebSocket error message:', data.error);
        // Broadcast error to all error handlers
        this.errorHandlers.forEach((handlers) => {
          handlers.forEach((handler) => handler(data.error));
        });
        break;
    }
  }

  private send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  subscribe(queryId: string, onEvent: WebSocketEventHandler, onError?: WebSocketErrorHandler): () => void {
    this.connect();

    // Add event handler
    if (!this.eventHandlers.has(queryId)) {
      this.eventHandlers.set(queryId, []);
    }
    this.eventHandlers.get(queryId)!.push(onEvent);

    // Add error handler if provided
    if (onError) {
      if (!this.errorHandlers.has(queryId)) {
        this.errorHandlers.set(queryId, []);
      }
      this.errorHandlers.get(queryId)!.push(onError);
    }

    // Send subscribe message or queue it
    if (this.isAuthenticated) {
      this.send({
        type: 'subscribe',
        queryId,
      });
    } else {
      this.pendingSubscriptions.push(queryId);
    }

    // Return unsubscribe function
    return () => {
      this.unsubscribe(queryId, onEvent, onError);
    };
  }

  private unsubscribe(
    queryId: string,
    onEvent: WebSocketEventHandler,
    onError?: WebSocketErrorHandler
  ): void {
    // Remove event handler
    const eventHandlers = this.eventHandlers.get(queryId);
    if (eventHandlers) {
      const index = eventHandlers.indexOf(onEvent);
      if (index > -1) {
        eventHandlers.splice(index, 1);
      }
      if (eventHandlers.length === 0) {
        this.eventHandlers.delete(queryId);
      }
    }

    // Remove error handler
    if (onError) {
      const errorHandlers = this.errorHandlers.get(queryId);
      if (errorHandlers) {
        const index = errorHandlers.indexOf(onError);
        if (index > -1) {
          errorHandlers.splice(index, 1);
        }
        if (errorHandlers.length === 0) {
          this.errorHandlers.delete(queryId);
        }
      }
    }

    // Send unsubscribe message if no more handlers for this query
    if (!this.eventHandlers.has(queryId) && this.isAuthenticated) {
      this.send({
        type: 'unsubscribe',
        queryId,
      });
    }
  }

  cancel(queryId: string): void {
    // Backend doesn't have cancel via WebSocket, would need to use REST API
    console.log('Cancel not implemented via WebSocket');
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.eventHandlers.clear();
    this.errorHandlers.clear();
    this.pendingSubscriptions = [];
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated;
  }
}

// Export singleton instance
export const wsClient = new WebSocketClient();
export default wsClient;
