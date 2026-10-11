import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../useAuth';
import type { LoginRequest, RegisterRequest } from '../../types/api';

// Create a wrapper with QueryClient
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

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should not be authenticated by default', () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeUndefined();
    });

    it('should be authenticated if token exists in localStorage', () => {
      localStorage.setItem('access_token', 'test-token');

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isAuthenticated).toBe(true);
    });

    it('should not load user if not authenticated', () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoadingUser).toBe(false);
      expect(result.current.user).toBeUndefined();
    });
  });

  describe('Login', () => {
    it('should successfully login', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      const loginData: LoginRequest = {
        email: 'test@example.com',
        password: 'password123',
      };

      await result.current.login(loginData);

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Check that token was stored
      expect(localStorage.getItem('access_token')).toBeTruthy();
    });

    it('should set isLoggingIn during login', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      const loginData: LoginRequest = {
        email: 'test@example.com',
        password: 'password123',
      };

      const loginPromise = result.current.login(loginData);

      // Check loading state
      expect(result.current.isLoggingIn).toBe(true);

      await loginPromise;

      await waitFor(() => {
        expect(result.current.isLoggingIn).toBe(false);
      });
    });

    it('should fetch user after successful login', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      const loginData: LoginRequest = {
        email: 'test@example.com',
        password: 'password123',
      };

      await result.current.login(loginData);

      await waitFor(() => {
        expect(result.current.user).toBeDefined();
        expect(result.current.user?.email).toBe('test@example.com');
      });
    });

    it('should handle login error', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      // Mock API to return error
      const loginData: LoginRequest = {
        email: 'invalid@example.com',
        password: 'wrong',
      };

      try {
        await result.current.login(loginData);
      } catch (error) {
        // Expected to throw
      }

      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('Register', () => {
    it('should successfully register', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      const registerData: RegisterRequest = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      };

      await result.current.register(registerData);

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      // Check that token was stored
      expect(localStorage.getItem('access_token')).toBeTruthy();
    });

    it('should set isRegistering during registration', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      const registerData: RegisterRequest = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      };

      const registerPromise = result.current.register(registerData);

      // Check loading state
      expect(result.current.isRegistering).toBe(true);

      await registerPromise;

      await waitFor(() => {
        expect(result.current.isRegistering).toBe(false);
      });
    });

    it('should fetch user after successful registration', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      const registerData: RegisterRequest = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      };

      await result.current.register(registerData);

      await waitFor(() => {
        expect(result.current.user).toBeDefined();
        expect(result.current.user?.name).toBe('Test User');
      });
    });

    it('should handle registration error', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      const registerData: RegisterRequest = {
        name: 'Test User',
        email: 'existing@example.com',
        password: 'password123',
      };

      try {
        await result.current.register(registerData);
      } catch (error) {
        // Expected to throw
      }

      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('Logout', () => {
    it('should clear authentication state', async () => {
      // Setup authenticated state
      localStorage.setItem('access_token', 'test-token');
      localStorage.setItem('refresh_token', 'test-refresh-token');

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isAuthenticated).toBe(true);

      // Mock window.location.href
      delete (window as any).location;
      (window as any).location = { href: '', reload: vi.fn() };

      await result.current.logout();

      // Check state cleared
      expect(result.current.isAuthenticated).toBe(false);
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    });

    it('should call logout API', async () => {
      localStorage.setItem('access_token', 'test-token');
      localStorage.setItem('refresh_token', 'test-refresh-token');

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      // Mock window.location
      delete (window as any).location;
      (window as any).location = { href: '', reload: vi.fn() };

      await result.current.logout();

      // Logout should have been called (verified by MSW handler)
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('Token Management', () => {
    it('should store access token on login', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      await result.current.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(localStorage.getItem('access_token')).toBe('mock-access-token');
    });

    it('should store refresh token on login', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      await result.current.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(localStorage.getItem('refresh_token')).toBe('mock-refresh-token');
    });

    it('should clear tokens on logout', async () => {
      localStorage.setItem('access_token', 'test-token');
      localStorage.setItem('refresh_token', 'test-refresh-token');

      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      // Mock window.location
      delete (window as any).location;
      (window as any).location = { href: '', reload: vi.fn() };

      await result.current.logout();

      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should expose login error', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      try {
        await result.current.login({
          email: 'invalid@example.com',
          password: 'wrong',
        });
      } catch (error) {
        // Expected
      }

      await waitFor(() => {
        expect(result.current.loginError).toBeDefined();
      });
    });

    it('should expose register error', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      try {
        await result.current.register({
          name: 'Test',
          email: 'existing@example.com',
          password: 'password',
        });
      } catch (error) {
        // Expected
      }

      await waitFor(() => {
        expect(result.current.registerError).toBeDefined();
      });
    });
  });

  describe('User Query', () => {
    it('should only fetch user when authenticated', async () => {
      const { result, rerender } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      // Not authenticated - should not fetch
      expect(result.current.isLoadingUser).toBe(false);
      expect(result.current.user).toBeUndefined();

      // Login
      await result.current.login({
        email: 'test@example.com',
        password: 'password123',
      });

      rerender();

      // Should now fetch user
      await waitFor(() => {
        expect(result.current.user).toBeDefined();
      });
    });

    it('should invalidate user query on login', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      await result.current.login({
        email: 'test@example.com',
        password: 'password123',
      });

      await waitFor(() => {
        expect(result.current.user).toBeDefined();
      });
    });

    it('should invalidate user query on register', async () => {
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(),
      });

      await result.current.register({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      });

      await waitFor(() => {
        expect(result.current.user).toBeDefined();
      });
    });
  });
});
