import { http, HttpResponse } from 'msw';

const API_BASE_URL = 'http://localhost:3000';

export const handlers = [
  // Auth endpoints
  http.post(`${API_BASE_URL}/api/auth/register`, async () => {
    return HttpResponse.json({
      token: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      user: {
        userId: 'user-1',
        plan: 'free',
        createdAt: '2026-02-11T00:00:00.000Z',
        email: 'test@example.com',
        name: 'Test User',
      },
    });
  }),

  http.post(`${API_BASE_URL}/api/auth/login`, async () => {
    return HttpResponse.json({
      token: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      user: {
        userId: 'user-1',
        plan: 'free',
        createdAt: '2026-02-11T00:00:00.000Z',
        email: 'test@example.com',
        name: 'Test User',
      },
    });
  }),

  http.post(`${API_BASE_URL}/api/auth/logout`, async () => {
    return HttpResponse.json({ message: 'Logged out successfully' });
  }),

  http.post(`${API_BASE_URL}/api/auth/refresh`, async () => {
    return HttpResponse.json({
      token: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
  }),

  // Session endpoints
  http.get(`${API_BASE_URL}/api/sessions`, async () => {
    return HttpResponse.json({
      sessions: [
        {
          sessionId: 'session-1',
          model: 'gpt-4',
          provider: 'openai',
          createdAt: '2026-02-11T00:00:00.000Z',
          updatedAt: '2026-02-11T00:00:00.000Z',
        },
      ],
      pagination: { total: 1, limit: 50, offset: 0 },
    });
  }),

  http.post(`${API_BASE_URL}/api/sessions`, async () => {
    return HttpResponse.json({
      sessionId: 'session-new',
      model: 'gpt-4',
      provider: 'openai',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }),

  http.get(`${API_BASE_URL}/api/sessions/:id`, async ({ params }) => {
    return HttpResponse.json({
      sessionId: params.id,
      model: 'gpt-4',
      provider: 'openai',
      createdAt: '2026-02-11T00:00:00.000Z',
      updatedAt: '2026-02-11T00:00:00.000Z',
    });
  }),

  http.patch(`${API_BASE_URL}/api/sessions/:id`, async ({ params, request }) => {
    const updates = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      sessionId: params.id,
      model: 'gpt-4',
      provider: 'openai',
      createdAt: '2026-02-11T00:00:00.000Z',
      updatedAt: new Date().toISOString(),
      ...updates,
    });
  }),

  http.delete(`${API_BASE_URL}/api/sessions/:id`, async () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Query endpoints
  http.post(`${API_BASE_URL}/api/queries`, async () => {
    return HttpResponse.json({
      queryId: 'query-1',
      status: 'processing',
    });
  }),

  http.get(`${API_BASE_URL}/api/queries/:id`, async ({ params }) => {
    return HttpResponse.json({
      queryId: params.id,
      sessionId: 'session-1',
      queryText: 'What is the revenue of AAPL?',
      status: 'completed',
      createdAt: '2026-02-11T00:00:00.000Z',
      updatedAt: '2026-02-11T00:00:00.000Z',
    });
  }),

  http.delete(`${API_BASE_URL}/api/queries/:id`, async ({ params }) => {
    return HttpResponse.json({
      queryId: params.id,
      status: 'cancelled',
      message: 'Query cancelled successfully',
    });
  }),

  // Model endpoints
  http.get(`${API_BASE_URL}/api/models`, async () => {
    return HttpResponse.json({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: [
            {
              id: 'gpt-4',
              name: 'GPT-4',
              provider: 'openai',
              contextWindow: 128000,
            },
          ],
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: [
            {
              id: 'claude-3',
              name: 'Claude 3',
              provider: 'anthropic',
              contextWindow: 200000,
            },
          ],
        },
      ],
    });
  }),

  // User endpoints
  http.get(`${API_BASE_URL}/api/users/me`, async () => {
    return HttpResponse.json({
      userId: 'user-1',
      plan: 'free',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: '2026-02-11T00:00:00.000Z',
      apiKeys: [],
      preferences: {},
    });
  }),

  // Health check
  http.get(`${API_BASE_URL}/api/health`, async () => {
    return HttpResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }),
];
