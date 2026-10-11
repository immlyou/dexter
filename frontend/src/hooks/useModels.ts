import { useQuery } from '@tanstack/react-query';
import { config } from '../config';
import { apiClient } from '../services/api';
import { mockApiClient } from '../services/mock/mockApi';

// Select API client based on config
const api = config.useMockApi ? mockApiClient : apiClient;

export function useModels() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.getModels(),
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  return {
    providers: data?.providers || [],
    models: data?.providers.flatMap((p) => p.models) || [],
    isLoading,
    error,
  };
}

export function useModel(provider: string, modelId: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['models', provider, modelId],
    queryFn: () => api.getModel(provider, modelId),
    enabled: !!provider && !!modelId,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  return {
    model: data,
    isLoading,
    error,
  };
}
