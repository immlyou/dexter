import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { config } from '../config';
import { apiClient } from '../services/api';
import { mockApiClient } from '../services/mock/mockApi';
import type { LoginRequest, RegisterRequest } from '../types/api';

// Select API client based on config
const api = config.useMockApi ? mockApiClient : apiClient;

export function useAuth() {
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return !!localStorage.getItem('access_token');
  });

  // Get current user
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ['user', 'me'],
    queryFn: () => api.getCurrentUser(),
    enabled: isAuthenticated,
    retry: false,
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: (data: LoginRequest) => api.login(data),
    onSuccess: () => {
      setIsAuthenticated(true);
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });

  // Register mutation
  const registerMutation = useMutation({
    mutationFn: (data: RegisterRequest) => api.register(data),
    onSuccess: () => {
      setIsAuthenticated(true);
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });

  // Logout
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setIsAuthenticated(false);
      queryClient.clear();
      // In mock mode, just reload the page
      if (config.useMockApi) {
        window.location.reload();
      } else {
        window.location.href = '/login';
      }
    }
  }, [queryClient]);

  return {
    user,
    isAuthenticated,
    isLoadingUser,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
    loginError: loginMutation.error,
    registerError: registerMutation.error,
  };
}
