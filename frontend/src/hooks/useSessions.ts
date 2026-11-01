import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { config } from '../config';
import { apiClient } from '../services/api';
import { mockApiClient } from '../services/mock/mockApi';
import type { CreateSessionRequest, UpdateSessionRequest } from '../types/api';

// Select API client based on config
const api = config.useMockApi ? mockApiClient : apiClient;

export function useSessions(params?: {
  limit?: number;
  offset?: number;
  sort?: 'createdAt' | 'updatedAt';
  order?: 'asc' | 'desc';
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions', params],
    queryFn: () => api.getSessions(params),
  });

  return {
    sessions: data?.sessions || [],
    pagination: data?.pagination,
    isLoading,
    error,
  };
}

export function useSession(sessionId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions', sessionId],
    queryFn: () => api.getSession(sessionId!),
    enabled: !!sessionId,
  });

  return {
    session: data,
    isLoading,
    error,
  };
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSessionRequest) => api.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useUpdateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ sessionId, data }: { sessionId: string; data: UpdateSessionRequest }) =>
      api.updateSession(sessionId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', variables.sessionId] });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => api.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
