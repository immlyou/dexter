import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { apiClient } from '../api';

describe('API Client', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, fn: () => Promise<unknown>) => fn() } });
    localStorage.clear();
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  });

  describe('Authentication APIs', () => {
    describe('register', () => {
      it('should register a new user', async () => {
        const result = await apiClient.register({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
        });

        expect(result).toHaveProperty('token');
        expect(result).toHaveProperty('refreshToken');
        expect(result).toHaveProperty('user');
        expect(result.user.email).toBe('test@example.com');
      });

      it('should store tokens after registration', async () => {
        await apiClient.register({
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
        });

        expect(localStorage.getItem('access_token')).toBe('mock-access-token');
        expect(localStorage.getItem('refresh_token')).toBe('mock-refresh-token');
      });
    });

    describe('login', () => {
      it('should login successfully', async () => {
        const result = await apiClient.login({
          email: 'test@example.com',
          password: 'password123',
        });

        expect(result).toHaveProperty('token');
        expect(result).toHaveProperty('refreshToken');
        expect(result.user.email).toBe('test@example.com');
      });

      it('should store tokens after login', async () => {
        await apiClient.login({
          email: 'test@example.com',
          password: 'password123',
        });

        expect(localStorage.getItem('access_token')).toBe('mock-access-token');
        expect(localStorage.getItem('refresh_token')).toBe('mock-refresh-token');
      });
    });

    describe('logout', () => {
      it('should logout successfully', async () => {
        localStorage.setItem('access_token', 'test-token');
        localStorage.setItem('refresh_token', 'test-refresh-token');

        await apiClient.logout();

        expect(localStorage.getItem('access_token')).toBeNull();
        expect(localStorage.getItem('refresh_token')).toBeNull();
      });

      it('should call logout endpoint', async () => {
        localStorage.setItem('refresh_token', 'test-refresh-token');

        let logoutCalled = false;
        server.use(
          http.post('http://localhost:3000/api/auth/logout', () => {
            logoutCalled = true;
            return HttpResponse.json({ message: 'Logged out' });
          })
        );

        await apiClient.logout();

        expect(logoutCalled).toBe(true);
      });
    });

    describe('refreshToken', () => {
      it('should refresh access token', async () => {
        localStorage.setItem('refresh_token', 'old-refresh-token');
        const result = await apiClient.refreshToken({
          refreshToken: 'old-refresh-token',
        });

        expect(result.token).toBe('new-access-token');
        expect(result.refreshToken).toBe('new-refresh-token');
      });

      it('should update stored tokens', async () => {
        localStorage.setItem('refresh_token', 'old-refresh-token');
        await apiClient.refreshToken({
          refreshToken: 'old-refresh-token',
        });

        expect(localStorage.getItem('access_token')).toBe('new-access-token');
        expect(localStorage.getItem('refresh_token')).toBe('new-refresh-token');
      });
    });
  });

  describe('Session APIs', () => {
    describe('getSessions', () => {
      it('should get sessions list', async () => {
        const result = await apiClient.getSessions();

        expect(result.sessions).toHaveLength(1);
        expect(result.sessions[0].sessionId).toBe('session-1');
      });

      it('should accept pagination params', async () => {
        const result = await apiClient.getSessions({
          limit: 10,
          offset: 0,
          sort: 'createdAt',
          order: 'desc',
        });

        expect(result).toBeDefined();
        expect(result.sessions).toBeDefined();
      });
    });

    describe('getSession', () => {
      it('should get single session', async () => {
        const result = await apiClient.getSession('session-1');

        expect(result.sessionId).toBe('session-1');
        expect(result.model).toBe('gpt-4');
      });
    });

    describe('createSession', () => {
      it('should create new session', async () => {
        const result = await apiClient.createSession({
          model: 'gpt-4',
          provider: 'openai',
        });

        expect(result.sessionId).toBe('session-new');
        expect(result.model).toBe('gpt-4');
      });
    });

    describe('updateSession', () => {
      it('should update session', async () => {
        const result = await apiClient.updateSession('session-1', {
          name: 'Updated Name',
        });

        expect(result).toBeDefined();
        expect(result.sessionId).toBe('session-1');
      });
    });

    describe('deleteSession', () => {
      it('should delete session', async () => {
        await expect(
          apiClient.deleteSession('session-1')
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('Query APIs', () => {
    describe('createQuery', () => {
      it('should create query', async () => {
        const result = await apiClient.createQuery({
          sessionId: 'session-1',
          query: 'What is the revenue of AAPL?',
        });

        expect(result.queryId).toBe('query-1');
        expect(result.status).toBe('processing');
      });
    });

    describe('getQuery', () => {
      it('should get query status', async () => {
        const result = await apiClient.getQuery('query-1');

        expect(result.queryId).toBe('query-1');
        expect(result.queryText).toBe('What is the revenue of AAPL?');
      });
    });

    describe('cancelQuery', () => {
      it('should cancel query', async () => {
        const result = await apiClient.cancelQuery('query-1');

        expect(result.queryId).toBe('query-1');
        expect(result.status).toBe('cancelled');
      });
    });

    describe('getQueryEvents', () => {
      it('should get query events', async () => {
        // Mock the endpoint
        server.use(
          http.get('http://localhost:3000/api/queries/:id/events', () => {
            return HttpResponse.json({
              events: [
                {
                  type: 'thinking',
                  message: 'Analyzing query...',
                  timestamp: new Date().toISOString(),
                },
              ],
              total: 1,
            });
          })
        );

        const result = await apiClient.getQueryEvents('query-1');

        expect(result.events).toHaveLength(1);
      });
    });
  });

  describe('Model APIs', () => {
    describe('getModels', () => {
      it('should get models list', async () => {
        const result = await apiClient.getModels();

        expect(result.providers).toHaveLength(2);
        expect(result.providers[0].id).toBe('openai');
      });
    });

    describe('getModel', () => {
      it('should get specific model', async () => {
        server.use(
          http.get('http://localhost:3000/api/models/:provider/:modelId', () => {
            return HttpResponse.json({
              id: 'gpt-4',
              name: 'GPT-4',
              provider: 'openai',
              contextWindow: 128000,
            });
          })
        );

        const result = await apiClient.getModel('openai', 'gpt-4');

        expect(result.id).toBe('gpt-4');
        expect(result.provider).toBe('openai');
      });
    });
  });

  describe('User APIs', () => {
    describe('getCurrentUser', () => {
      it('should get current user', async () => {
        const result = await apiClient.getCurrentUser();

        expect(result.userId).toBe('user-1');
        expect(result.email).toBe('test@example.com');
      });
    });

    describe('updateCurrentUser', () => {
      it('should update user', async () => {
        server.use(
          http.patch('http://localhost:3000/api/users/me', () => {
            return HttpResponse.json({
              userId: 'user-1',
              name: 'Updated Name',
              email: 'test@example.com',
              createdAt: new Date().toISOString(),
              apiKeys: [],
              preferences: {},
            });
          })
        );

        const result = await apiClient.updateCurrentUser({
          name: 'Updated Name',
        });

        expect(result.name).toBe('Updated Name');
      });
    });

    describe('createAPIKey', () => {
      it('should create API key', async () => {
        server.use(
          http.post('http://localhost:3000/api/users/me/api-keys', () => {
            return HttpResponse.json({
              keyId: 'key-1',
              key: 'sk-test-key',
              name: 'Test Key',
              createdAt: new Date().toISOString(),
            });
          })
        );

        const result = await apiClient.createAPIKey({
          name: 'Test Key',
        });

        expect(result.keyId).toBe('key-1');
        expect(result.key).toBe('sk-test-key');
      });
    });

    describe('deleteAPIKey', () => {
      it('should delete API key', async () => {
        server.use(
          http.delete('http://localhost:3000/api/users/me/api-keys/:keyId', () => {
            return new HttpResponse(null, { status: 204 });
          })
        );

        await expect(
          apiClient.deleteAPIKey('key-1')
        ).resolves.toBeUndefined();
      });
    });
  });

  describe('Health Check', () => {
    it('should check API health', async () => {
      const result = await apiClient.healthCheck();

      expect(result.status).toBe('ok');
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('Token Management', () => {
    describe('Request Interceptor', () => {
      it('should add Authorization header when token exists', async () => {
        localStorage.setItem('access_token', 'test-token');

        let authHeader: string | undefined;
        server.use(
          http.get('http://localhost:3000/api/users/me', ({ request }) => {
            authHeader = request.headers.get('Authorization') || undefined;
            return HttpResponse.json({
              userId: 'user-1',
              email: 'test@example.com',
              name: 'Test User',
              createdAt: new Date().toISOString(),
              apiKeys: [],
              preferences: {},
            });
          })
        );

        await apiClient.getCurrentUser();

        expect(authHeader).toBe('Bearer test-token');
      });

      it('should not add Authorization header when token is missing', async () => {
        localStorage.removeItem('access_token');

        let authHeader: string | null = 'should-be-null';
        server.use(
          http.post('http://localhost:3000/api/auth/login', ({ request }) => {
            authHeader = request.headers.get('Authorization');
            return HttpResponse.json({
              token: 'new-token',
              refreshToken: 'new-refresh-token',
              user: {
                userId: 'user-1',
                email: 'test@example.com',
                name: 'Test User',
              },
            });
          })
        );

        await apiClient.login({
          email: 'test@example.com',
          password: 'password123',
        });

        expect(authHeader).toBeNull();
      });
    });

    describe('Response Interceptor - Auto Refresh', () => {
      it('should refresh token on 401 error', async () => {
        localStorage.setItem('access_token', 'expired-token');
        localStorage.setItem('refresh_token', 'valid-refresh-token');

        let requestCount = 0;

        server.use(
          http.get('http://localhost:3000/api/users/me', ({ request }) => {
            requestCount++;
            const auth = request.headers.get('Authorization');

            // First request with expired token
            if (auth === 'Bearer expired-token') {
              return new HttpResponse(null, { status: 401 });
            }

            // Second request with new token
            return HttpResponse.json({
              userId: 'user-1',
              email: 'test@example.com',
              name: 'Test User',
              createdAt: new Date().toISOString(),
              apiKeys: [],
              preferences: {},
            });
          })
        );

        const result = await apiClient.getCurrentUser();

        expect(result.userId).toBe('user-1');
        expect(requestCount).toBe(2); // Original + retry
        expect(localStorage.getItem('access_token')).toBe('new-access-token');
      });

      it('without Web Locks a 401 ends the session so the login gate shows the form', async () => {
        vi.stubGlobal('navigator', {});
        localStorage.setItem('access_token', 'expired-token');
        localStorage.setItem('refresh_token', 'valid-refresh-token');
        const refresh = vi.fn(() => HttpResponse.json({ token: 'never', refreshToken: 'never' }));
        server.use(
          http.get('http://localhost:3000/api/users/me', () => new HttpResponse(null, { status: 401 })),
          http.post('http://localhost:3000/api/auth/refresh', refresh),
        );

        await expect(apiClient.getCurrentUser()).rejects.toThrow('Web Locks');

        expect(refresh).not.toHaveBeenCalled();
        // App's gate (App.tsx) shows LoginPage exactly when no access token is stored.
        expect(localStorage.getItem('access_token')).toBeNull();
        expect(localStorage.getItem('refresh_token')).toBeNull();
      });

      it('should not retry with X-Retry header', async () => {
        localStorage.setItem('access_token', 'token');

        server.use(
          http.get('http://localhost:3000/api/users/me', () => {
            return new HttpResponse(null, { status: 401 });
          })
        );

        try {
          await apiClient.getCurrentUser();
        } catch (error) {
          expect(error).toBeDefined();
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      server.use(
        http.get('http://localhost:3000/api/sessions', () => {
          return HttpResponse.error();
        })
      );

      await expect(apiClient.getSessions()).rejects.toThrow();
    });

    it('should handle 404 errors', async () => {
      server.use(
        http.get('http://localhost:3000/api/sessions/:id', () => {
          return new HttpResponse(null, { status: 404 });
        })
      );

      await expect(apiClient.getSession('nonexistent')).rejects.toThrow();
    });

    it('should handle 500 errors', async () => {
      server.use(
        http.get('http://localhost:3000/api/sessions', () => {
          return new HttpResponse(null, { status: 500 });
        })
      );

      await expect(apiClient.getSessions()).rejects.toThrow();
    });
  });
});
