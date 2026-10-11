import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery as useReactQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '../config';
import { apiClient } from '../services/api';
import { wsClient } from '../services/websocket';
import { mockApiClient } from '../services/mock/mockApi';
import { mockWsClient } from '../services/mock/mockWebSocket';
import type { AgentEvent } from '../types';
import type { CreateQueryRequest, Query } from '../types/api';

// Select API client based on config
const api = config.useMockApi ? mockApiClient : apiClient;
const ws = config.useMockApi ? mockWsClient : wsClient;

export function useQuery(queryId: string | undefined) {
  const { data, isLoading, error } = useReactQuery({
    queryKey: ['queries', queryId],
    queryFn: () => api.getQuery(queryId!),
    enabled: !!queryId,
    refetchInterval: (query) => {
      // Poll every 2 seconds if status is processing
      return query.state.data?.status === 'processing' ? 2000 : false;
    },
  });

  return {
    query: data,
    isLoading,
    error,
  };
}

export function useCreateQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateQueryRequest) => api.createQuery(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queries'] });
    },
  });
}

export function useCancelQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (queryId: string) => {
      ws.cancel(queryId);
      return api.cancelQuery(queryId);
    },
    onSuccess: (_, queryId) => {
      queryClient.invalidateQueries({ queryKey: ['queries', queryId] });
    },
  });
}

export interface UseQueryStreamOptions {
  onEvent?: (event: AgentEvent) => void;
  onComplete?: (answer: string) => void;
  onError?: (error: { code: string; message: string }) => void;
}

export function useQueryStream(queryId: string | undefined, options?: UseQueryStreamOptions) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!queryId) return;

    setIsConnected(true);

    const handleEvent = (event: AgentEvent) => {
      setEvents((prev) => [...prev, event]);
      options?.onEvent?.(event);

      if (event.type === 'done') {
        setAnswer(event.answer);
        options?.onComplete?.(event.answer);
      }
    };

    const handleError = (err: { code: string; message: string }) => {
      setError(err.message);
      options?.onError?.(err);
    };

    const unsubscribe = ws.subscribe(queryId, handleEvent, handleError);

    return () => {
      unsubscribe();
      setIsConnected(false);
    };
  }, [queryId, options]);

  const cancel = useCallback(() => {
    if (queryId) {
      ws.cancel(queryId);
    }
  }, [queryId]);

  return {
    events,
    answer,
    error,
    isConnected,
    cancel,
  };
}
