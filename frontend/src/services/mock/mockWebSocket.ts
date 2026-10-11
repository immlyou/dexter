// Mock WebSocket client for development
import type { AgentEvent } from '../../types';
import { generateMockEvents } from './mockData';

type EventHandler = (event: AgentEvent) => void;
type ErrorHandler = (error: { code: string; message: string }) => void;

class MockWebSocketClient {
  private subscriptions: Map<string, { events: EventHandler[]; errors: ErrorHandler[] }> = new Map();
  private eventTimeouts: Map<string, NodeJS.Timeout[]> = new Map();

  subscribe(queryId: string, onEvent: EventHandler, onError?: ErrorHandler): () => void {
    // Add handlers
    if (!this.subscriptions.has(queryId)) {
      this.subscriptions.set(queryId, { events: [], errors: [] });
    }
    const sub = this.subscriptions.get(queryId)!;
    sub.events.push(onEvent);
    if (onError) {
      sub.errors.push(onError);
    }

    console.log(`[MockWS] Subscribed to query ${queryId}`);

    // Start emitting mock events
    this.startEmittingEvents(queryId);

    // Return unsubscribe function
    return () => {
      this.unsubscribe(queryId, onEvent, onError);
    };
  }

  private startEmittingEvents(queryId: string): void {
    // Don't start if already emitting
    if (this.eventTimeouts.has(queryId)) {
      return;
    }

    const timeouts: NodeJS.Timeout[] = [];
    const mockEvents = generateMockEvents('Sample query');
    const sub = this.subscriptions.get(queryId);
    if (!sub) return;

    // Emit events with realistic delays
    mockEvents.forEach((event, index) => {
      const delay = index * 800; // 800ms between events
      const timeout = setTimeout(() => {
        console.log(`[MockWS] Emitting event:`, event.type);
        sub.events.forEach((handler) => handler(event));
      }, delay);
      timeouts.push(timeout);
    });

    this.eventTimeouts.set(queryId, timeouts);
  }

  private unsubscribe(queryId: string, onEvent: EventHandler, onError?: ErrorHandler): void {
    const sub = this.subscriptions.get(queryId);
    if (!sub) return;

    // Remove handlers
    const eventIndex = sub.events.indexOf(onEvent);
    if (eventIndex > -1) {
      sub.events.splice(eventIndex, 1);
    }

    if (onError) {
      const errorIndex = sub.errors.indexOf(onError);
      if (errorIndex > -1) {
        sub.errors.splice(errorIndex, 1);
      }
    }

    // Clean up if no more handlers
    if (sub.events.length === 0 && sub.errors.length === 0) {
      this.subscriptions.delete(queryId);

      // Clear timeouts
      const timeouts = this.eventTimeouts.get(queryId);
      if (timeouts) {
        timeouts.forEach(clearTimeout);
        this.eventTimeouts.delete(queryId);
      }

      console.log(`[MockWS] Unsubscribed from query ${queryId}`);
    }
  }

  cancel(queryId: string): void {
    console.log(`[MockWS] Cancelling query ${queryId}`);

    // Clear all timeouts for this query
    const timeouts = this.eventTimeouts.get(queryId);
    if (timeouts) {
      timeouts.forEach(clearTimeout);
      this.eventTimeouts.delete(queryId);
    }

    // Emit cancelled event
    const sub = this.subscriptions.get(queryId);
    if (sub) {
      const cancelEvent: AgentEvent = {
        type: 'done',
        answer: 'Query cancelled by user',
        toolCalls: 0,
        iterations: 0,
        totalTime: 0,
        timestamp: new Date().toISOString(),
      };
      sub.events.forEach((handler) => handler(cancelEvent));
    }
  }

  disconnect(): void {
    console.log('[MockWS] Disconnecting...');

    // Clear all timeouts
    this.eventTimeouts.forEach((timeouts) => {
      timeouts.forEach(clearTimeout);
    });

    this.subscriptions.clear();
    this.eventTimeouts.clear();
  }

  isConnected(): boolean {
    return true; // Always connected in mock mode
  }
}

// Export singleton instance
export const mockWsClient = new MockWebSocketClient();
export default mockWsClient;
