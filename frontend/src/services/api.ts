import axios from 'axios';
import type { AxiosInstance, AxiosError } from 'axios';
import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  RefreshTokenRequest,
  RefreshTokenResponse,
  Session,
  CreateSessionRequest,
  UpdateSessionRequest,
  SessionListResponse,
  Query,
  CreateQueryRequest,
  CreateQueryResponse,
  QueryEventListResponse,
  ModelListResponse,
  Model,
  UserWithDetails,
  CreateAPIKeyRequest,
  CreateAPIKeyResponse,
  HealthCheck,
  ApiError,
} from '../types/api';

// API Base URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

class ApiClient {
  private client: AxiosInstance;
  private refreshTokenPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor - add auth token
    this.client.interceptors.request.use(
      (config) => {
        const token = this.getToken();
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - handle errors and token refresh
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError<ApiError>) => {
        const originalRequest = error.config;

        // Handle 401 Unauthorized - try to refresh token
        if (error.response?.status === 401 && originalRequest && !originalRequest.headers?.['X-Retry']) {
          try {
            const newToken = await this.refreshAccessToken();
            originalRequest.headers = originalRequest.headers || {};
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            originalRequest.headers['X-Retry'] = 'true';
            return this.client(originalRequest);
          } catch (refreshError) {
            // Refresh failed, clear tokens and redirect to login
            this.clearTokens();
            window.location.href = '/login';
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  // Token management
  private getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  private setToken(token: string): void {
    localStorage.setItem('access_token', token);
  }

  private getRefreshToken(): string | null {
    return localStorage.getItem('refresh_token');
  }

  private setRefreshToken(token: string): void {
    localStorage.setItem('refresh_token', token);
  }

  private clearTokens(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }

  private async refreshAccessToken(): Promise<string> {
    // Prevent multiple simultaneous refresh requests
    if (this.refreshTokenPromise) {
      return this.refreshTokenPromise;
    }

    this.refreshTokenPromise = (async () => {
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      try {
        const response = await axios.post<RefreshTokenResponse>(
          `${API_BASE_URL}/api/auth/refresh`,
          { refreshToken }
        );

        const { token, refreshToken: newRefreshToken } = response.data;
        this.setToken(token);
        this.setRefreshToken(newRefreshToken);
        return token;
      } finally {
        this.refreshTokenPromise = null;
      }
    })();

    return this.refreshTokenPromise;
  }

  // Auth APIs
  async register(data: RegisterRequest): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/api/auth/register', data);
    this.setToken(response.data.token);
    this.setRefreshToken(response.data.refreshToken);
    return response.data;
  }

  async login(data: LoginRequest): Promise<AuthResponse> {
    const response = await this.client.post<AuthResponse>('/api/auth/login', data);
    this.setToken(response.data.token);
    this.setRefreshToken(response.data.refreshToken);
    return response.data;
  }

  async logout(): Promise<void> {
    const refreshToken = this.getRefreshToken();
    if (refreshToken) {
      await this.client.post('/api/auth/logout', { refreshToken });
    }
    this.clearTokens();
  }

  async refreshToken(data: RefreshTokenRequest): Promise<RefreshTokenResponse> {
    const response = await this.client.post<RefreshTokenResponse>('/api/auth/refresh', data);
    this.setToken(response.data.token);
    this.setRefreshToken(response.data.refreshToken);
    return response.data;
  }

  // Session APIs
  async getSessions(params?: {
    limit?: number;
    offset?: number;
    sort?: 'createdAt' | 'updatedAt';
    order?: 'asc' | 'desc';
  }): Promise<SessionListResponse> {
    const response = await this.client.get<SessionListResponse>('/api/sessions', { params });
    return response.data;
  }

  async getSession(sessionId: string): Promise<Session> {
    const response = await this.client.get<Session>(`/api/sessions/${sessionId}`);
    return response.data;
  }

  async createSession(data: CreateSessionRequest): Promise<Session> {
    const response = await this.client.post<Session>('/api/sessions', data);
    return response.data;
  }

  async updateSession(sessionId: string, data: UpdateSessionRequest): Promise<Session> {
    const response = await this.client.patch<Session>(`/api/sessions/${sessionId}`, data);
    return response.data;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.delete(`/api/sessions/${sessionId}`);
  }

  // Query APIs
  async createQuery(data: CreateQueryRequest): Promise<CreateQueryResponse> {
    const response = await this.client.post<CreateQueryResponse>('/api/queries', data);
    return response.data;
  }

  async getQuery(queryId: string): Promise<Query> {
    const response = await this.client.get<Query>(`/api/queries/${queryId}`);
    return response.data;
  }

  async cancelQuery(queryId: string): Promise<{ queryId: string; status: string; message: string }> {
    const response = await this.client.delete(`/api/queries/${queryId}`);
    return response.data;
  }

  async getQueryEvents(queryId: string, params?: { limit?: number; offset?: number }): Promise<QueryEventListResponse> {
    const response = await this.client.get<QueryEventListResponse>(`/api/queries/${queryId}/events`, { params });
    return response.data;
  }

  // Model APIs
  async getModels(): Promise<ModelListResponse> {
    const response = await this.client.get<ModelListResponse>('/api/models');
    return response.data;
  }

  async getModel(provider: string, modelId: string): Promise<Model> {
    const response = await this.client.get<Model>(`/api/models/${provider}/${modelId}`);
    return response.data;
  }

  // User APIs
  async getCurrentUser(): Promise<UserWithDetails> {
    const response = await this.client.get<UserWithDetails>('/api/users/me');
    return response.data;
  }

  async updateCurrentUser(data: { name?: string; preferences?: Record<string, unknown> }): Promise<UserWithDetails> {
    const response = await this.client.patch<UserWithDetails>('/api/users/me', data);
    return response.data;
  }

  async createAPIKey(data: CreateAPIKeyRequest): Promise<CreateAPIKeyResponse> {
    const response = await this.client.post<CreateAPIKeyResponse>('/api/users/me/api-keys', data);
    return response.data;
  }

  async deleteAPIKey(keyId: string): Promise<void> {
    await this.client.delete(`/api/users/me/api-keys/${keyId}`);
  }

  // Health Check
  async healthCheck(): Promise<HealthCheck> {
    const response = await this.client.get<HealthCheck>('/api/health');
    return response.data;
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
export default apiClient;
