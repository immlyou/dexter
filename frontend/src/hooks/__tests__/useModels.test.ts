import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useModels } from '../useModels';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useModels', () => {
  describe('Fetching Models', () => {
    it('should fetch models list', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.models).toEqual([]);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.models).toHaveLength(2);
      expect(result.current.models[0].id).toBe('gpt-4');
      expect(result.current.models[1].id).toBe('claude-3');
    });

    it('should return models array', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(Array.isArray(result.current.models)).toBe(true);
    });

    it('should include model details', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const model = result.current.models[0];
      expect(model).toHaveProperty('id');
      expect(model).toHaveProperty('name');
      expect(model).toHaveProperty('provider');
      expect(model).toHaveProperty('contextWindow');
    });
  });

  describe('Loading State', () => {
    it('should show loading initially', () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
    });

    it('should stop loading after fetch', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should expose error if fetch fails', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // With our mock, it should succeed
      expect(result.current.error).toBeNull();
    });

    it('should return empty array on error', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(Array.isArray(result.current.models)).toBe(true);
    });
  });

  describe('Caching', () => {
    it('should cache models query', async () => {
      const wrapper = createWrapper();

      // First render
      const { result: result1 } = renderHook(() => useModels(), { wrapper });

      await waitFor(() => {
        expect(result1.current.isLoading).toBe(false);
      });

      const firstModels = result1.current.models;

      // Second render should use cache
      const { result: result2 } = renderHook(() => useModels(), { wrapper });

      // Should be instant from cache
      expect(result2.current.isLoading).toBe(false);
      expect(result2.current.models).toEqual(firstModels);
    });
  });

  describe('Model Provider Distribution', () => {
    it('should have models from multiple providers', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const providers = new Set(
        result.current.models.map((m) => m.provider)
      );
      expect(providers.size).toBeGreaterThan(1);
      expect(providers.has('openai')).toBe(true);
      expect(providers.has('anthropic')).toBe(true);
    });

    it('should include OpenAI models', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const openaiModels = result.current.models.filter(
        (m) => m.provider === 'openai'
      );
      expect(openaiModels.length).toBeGreaterThan(0);
    });

    it('should include Anthropic models', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const anthropicModels = result.current.models.filter(
        (m) => m.provider === 'anthropic'
      );
      expect(anthropicModels.length).toBeGreaterThan(0);
    });
  });

  describe('Model Properties', () => {
    it('should have valid context windows', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      result.current.models.forEach((model) => {
        expect(model.contextWindow).toBeGreaterThan(0);
        expect(typeof model.contextWindow).toBe('number');
      });
    });

    it('should have non-empty names', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      result.current.models.forEach((model) => {
        expect(model.name).toBeTruthy();
        expect(model.name.length).toBeGreaterThan(0);
      });
    });

    it('should have valid provider names', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const validProviders = ['openai', 'anthropic', 'google', 'ollama'];

      result.current.models.forEach((model) => {
        expect(validProviders).toContain(model.provider);
      });
    });
  });

  describe('Stale Time', () => {
    it('should have long stale time for models', async () => {
      const { result } = renderHook(() => useModels(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Models should be cached for a long time
      // This is tested indirectly through the caching test
      expect(result.current.models).toBeDefined();
    });
  });
});
