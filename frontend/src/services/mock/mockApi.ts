// Mock API client for development
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  Session,
  CreateSessionRequest,
  UpdateSessionRequest,
  SessionListResponse,
  Query,
  CreateQueryRequest,
  CreateQueryResponse,
  ModelListResponse,
  UserWithDetails,
} from '../../types/api';
import { mockUser, mockSessions, mockProviders, generateMockAnswer } from './mockData';

// Simulate network delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class MockApiClient {
  private sessions: Session[] = [...mockSessions];
  private queries: Map<string, Query> = new Map();

  // Auth APIs
  async login(data: LoginRequest): Promise<AuthResponse> {
    await delay(500);
    console.log('[MockAPI] Login:', data.email);

    localStorage.setItem('access_token', 'mock_access_token_' + Date.now());
    localStorage.setItem('refresh_token', 'mock_refresh_token_' + Date.now());

    return {
      userId: mockUser.userId,
      token: 'mock_access_token_' + Date.now(),
      refreshToken: 'mock_refresh_token_' + Date.now(),
      user: mockUser,
    };
  }

  async register(data: RegisterRequest): Promise<AuthResponse> {
    await delay(500);
    console.log('[MockAPI] Register:', data.email);

    return this.login({ email: data.email, password: data.password });
  }

  async logout(): Promise<void> {
    await delay(200);
    console.log('[MockAPI] Logout');

    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }

  // Session APIs
  async getSessions(params?: {
    limit?: number;
    offset?: number;
    sort?: 'createdAt' | 'updatedAt';
    order?: 'asc' | 'desc';
  }): Promise<SessionListResponse> {
    await delay(300);
    console.log('[MockAPI] Get sessions', params);

    let sessions = [...this.sessions];

    // Sort
    if (params?.sort) {
      sessions.sort((a, b) => {
        const aVal = new Date(a[params.sort!]).getTime();
        const bVal = new Date(b[params.sort!]).getTime();
        return params.order === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    // Paginate
    const offset = params?.offset || 0;
    const limit = params?.limit || 20;
    const paginated = sessions.slice(offset, offset + limit);

    return {
      sessions: paginated,
      pagination: {
        total: sessions.length,
        limit,
        offset,
        hasMore: offset + limit < sessions.length,
      },
    };
  }

  async getSession(sessionId: string): Promise<Session> {
    await delay(200);
    console.log('[MockAPI] Get session', sessionId);

    const session = this.sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    return session;
  }

  async createSession(data: CreateSessionRequest): Promise<Session> {
    await delay(400);
    console.log('[MockAPI] Create session', data);

    const newSession: Session = {
      sessionId: 'ses_' + Date.now(),
      name: data.name || 'New Session',
      model: data.model,
      provider: data.provider,
      config: { maxIterations: data.maxIterations || 10 },
      queryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.unshift(newSession);
    return newSession;
  }

  async updateSession(sessionId: string, data: UpdateSessionRequest): Promise<Session> {
    await delay(300);
    console.log('[MockAPI] Update session', sessionId, data);

    const session = this.sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    Object.assign(session, data, { updatedAt: new Date().toISOString() });
    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await delay(300);
    console.log('[MockAPI] Delete session', sessionId);

    const index = this.sessions.findIndex((s) => s.sessionId === sessionId);
    if (index > -1) {
      this.sessions.splice(index, 1);
    }
  }

  // Query APIs
  async createQuery(data: CreateQueryRequest): Promise<CreateQueryResponse> {
    await delay(400);
    console.log('[MockAPI] Create query', data);

    const queryId = 'qry_' + Date.now();
    const query: Query = {
      queryId,
      sessionId: data.sessionId,
      queryText: data.query,
      status: 'processing',
      createdAt: new Date().toISOString(),
    };

    this.queries.set(queryId, query);

    // Simulate query completion after 5 seconds
    setTimeout(() => {
      const q = this.queries.get(queryId);
      if (q) {
        q.status = 'completed';
        q.answer = generateMockAnswer(data.query);
        q.iterations = 2;
        q.totalTime = 4500;
        q.tokenUsage = {
          inputTokens: 2500,
          outputTokens: 800,
          totalTokens: 3300,
        };
        q.tokensPerSecond = 64.5;
        q.completedAt = new Date().toISOString();
      }
    }, 5000);

    return {
      queryId,
      sessionId: data.sessionId,
      queryText: data.query,
      status: 'processing',
      createdAt: new Date().toISOString(),
      streamUrl: `ws://localhost:3000/stream?queryId=${queryId}`,
    };
  }

  async getQuery(queryId: string): Promise<Query> {
    await delay(200);
    console.log('[MockAPI] Get query', queryId);

    const query = this.queries.get(queryId);
    if (!query) {
      throw new Error('Query not found');
    }

    return query;
  }

  async cancelQuery(queryId: string): Promise<{ queryId: string; status: string; message: string }> {
    await delay(200);
    console.log('[MockAPI] Cancel query', queryId);

    const query = this.queries.get(queryId);
    if (query) {
      query.status = 'cancelled';
    }

    return {
      queryId,
      status: 'cancelled',
      message: 'Query cancelled successfully',
    };
  }

  // Model APIs
  async getModels(): Promise<ModelListResponse> {
    await delay(300);
    console.log('[MockAPI] Get models');

    return {
      providers: mockProviders,
    };
  }

  // User APIs
  async getCurrentUser(): Promise<UserWithDetails> {
    await delay(200);
    console.log('[MockAPI] Get current user');

    return {
      ...mockUser,
      usage: {
        queriesThisMonth: 45,
        queriesLimit: 100,
        tokensThisMonth: 250000,
        tokensLimit: 1000000,
      },
    };
  }
}

// Export singleton instance
export const mockApiClient = new MockApiClient();
export default mockApiClient;
