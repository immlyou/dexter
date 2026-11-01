// API Types (based on OpenAPI schema)

// Auth Types
export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  userId: string;
  token: string;
  refreshToken: string;
  user: User;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  token: string;
  refreshToken: string;
}

// User Types
export interface User {
  userId: string;
  email: string;
  name?: string;
  plan: 'free' | 'pro' | 'enterprise';
  preferences?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface UserUsage {
  queriesThisMonth: number;
  queriesLimit: number;
  tokensThisMonth: number;
  tokensLimit: number;
}

export interface UserWithDetails extends User {
  usage?: UserUsage;
  apiKeys?: APIKey[];
}

// Session Types
export interface Session {
  sessionId: string;
  userId?: string;
  name?: string;
  model: string;
  provider: string;
  config?: {
    maxIterations?: number;
    [key: string]: unknown;
  };
  queryCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRequest {
  name?: string;
  model: string;
  provider: string;
  maxIterations?: number;
}

export interface UpdateSessionRequest {
  name?: string;
  model?: string;
  provider?: string;
  maxIterations?: number;
}

export interface SessionListResponse {
  sessions: Session[];
  pagination: Pagination;
}

// Query Types
export interface Query {
  queryId: string;
  sessionId: string;
  userId?: string;
  queryText: string;
  status: 'processing' | 'completed' | 'error' | 'cancelled';
  answer?: string;
  iterations?: number;
  totalTime?: number;
  tokenUsage?: TokenUsage;
  tokensPerSecond?: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

export interface CreateQueryRequest {
  sessionId: string;
  query: string;
}

export interface CreateQueryResponse {
  queryId: string;
  sessionId: string;
  queryText: string;
  status: 'processing';
  createdAt: string;
  streamUrl: string;
}

export interface QueryEvent {
  eventId: string;
  queryId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface QueryEventListResponse {
  queryId: string;
  events: QueryEvent[];
  pagination: Pagination;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Model Types
export interface Model {
  id: string;
  name: string;
  provider: string;
  capabilities?: string[];
  contextWindow?: number;
  pricing?: {
    input: number;
    output: number;
    unit: string;
  };
  description?: string;
}

export interface Provider {
  id: string;
  name: string;
  models: Model[];
}

export interface ModelListResponse {
  providers: Provider[];
}

// API Key Types
export interface APIKey {
  keyId: string;
  userId?: string;
  name?: string;
  lastUsed?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface CreateAPIKeyRequest {
  name: string;
  expiresIn?: number;
}

export interface CreateAPIKeyResponse {
  keyId: string;
  key: string;
  name: string;
  expiresAt?: string;
  createdAt: string;
}

// Common Types
export interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore?: boolean;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
    requestId?: string;
  };
}

// Health Check
export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  timestamp: string;
  services: {
    database: 'healthy' | 'unhealthy';
    redis: 'healthy' | 'unhealthy';
    llm: 'healthy' | 'unhealthy';
  };
}
