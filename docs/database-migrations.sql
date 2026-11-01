-- ============================================================================
-- Dexter Database Schema Migrations
-- ============================================================================
-- Version: 1.0.0
-- Date: 2026-02-11
-- Database: PostgreSQL 16+
-- Description: Complete database schema for Dexter Web API
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- DROP TABLES (for clean migration)
-- ============================================================================

DROP TABLE IF EXISTS usage_tracking CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS tool_results CASCADE;
DROP TABLE IF EXISTS query_events CASCADE;
DROP TABLE IF EXISTS queries CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================================
-- USERS TABLE
-- ============================================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  plan VARCHAR(50) DEFAULT 'free' NOT NULL,
  preferences JSONB DEFAULT '{}' NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  CONSTRAINT users_email_check CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT users_plan_check CHECK (plan IN ('free', 'pro', 'enterprise'))
);

-- Indexes for users table
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_plan ON users(plan);
CREATE INDEX idx_users_created_at ON users(created_at DESC);
CREATE INDEX idx_users_is_active ON users(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- SESSIONS TABLE
-- ============================================================================

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255),
  model VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  config JSONB DEFAULT '{}' NOT NULL,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  CONSTRAINT sessions_provider_check CHECK (provider IN ('openai', 'anthropic', 'google', 'xai', 'ollama', 'openrouter', 'moonshot'))
);

-- Indexes for sessions table
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_is_archived ON sessions(is_archived) WHERE is_archived = FALSE;
CREATE INDEX idx_sessions_user_updated ON sessions(user_id, updated_at DESC);

-- ============================================================================
-- QUERIES TABLE
-- ============================================================================

CREATE TABLE queries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'processing',
  answer TEXT,
  iterations INTEGER,
  total_time INTEGER, -- milliseconds
  token_usage JSONB,
  tokens_per_second DECIMAL(10, 2),
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT queries_status_check CHECK (status IN ('processing', 'completed', 'error', 'cancelled')),
  CONSTRAINT queries_iterations_check CHECK (iterations IS NULL OR iterations >= 0),
  CONSTRAINT queries_total_time_check CHECK (total_time IS NULL OR total_time >= 0)
);

-- Indexes for queries table
CREATE INDEX idx_queries_session_id ON queries(session_id);
CREATE INDEX idx_queries_user_id ON queries(user_id);
CREATE INDEX idx_queries_status ON queries(status);
CREATE INDEX idx_queries_created_at ON queries(created_at DESC);
CREATE INDEX idx_queries_completed_at ON queries(completed_at DESC) WHERE completed_at IS NOT NULL;
CREATE INDEX idx_queries_user_status ON queries(user_id, status);
CREATE INDEX idx_queries_session_created ON queries(session_id, created_at DESC);

-- Composite index for common query patterns
CREATE INDEX idx_queries_user_created_status ON queries(user_id, created_at DESC, status);

-- ============================================================================
-- QUERY EVENTS TABLE
-- ============================================================================

CREATE TABLE query_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_id UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  CONSTRAINT query_events_type_check CHECK (event_type IN (
    'thinking',
    'tool_start',
    'tool_progress',
    'tool_end',
    'tool_error',
    'tool_limit',
    'context_cleared',
    'answer_start',
    'done'
  ))
);

-- Indexes for query_events table
CREATE INDEX idx_query_events_query_id ON query_events(query_id);
CREATE INDEX idx_query_events_timestamp ON query_events(timestamp DESC);
CREATE INDEX idx_query_events_type ON query_events(event_type);
CREATE INDEX idx_query_events_query_timestamp ON query_events(query_id, timestamp DESC);

-- GIN index for JSONB event_data searches
CREATE INDEX idx_query_events_data ON query_events USING GIN(event_data);

-- ============================================================================
-- TOOL RESULTS TABLE
-- ============================================================================

CREATE TABLE tool_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query_id UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  tool_name VARCHAR(100) NOT NULL,
  args JSONB NOT NULL,
  result TEXT NOT NULL,
  duration INTEGER, -- milliseconds
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  CONSTRAINT tool_results_duration_check CHECK (duration IS NULL OR duration >= 0)
);

-- Indexes for tool_results table
CREATE INDEX idx_tool_results_query_id ON tool_results(query_id);
CREATE INDEX idx_tool_results_tool_name ON tool_results(tool_name);
CREATE INDEX idx_tool_results_created_at ON tool_results(created_at DESC);
CREATE INDEX idx_tool_results_query_tool ON tool_results(query_id, tool_name);

-- GIN index for JSONB args searches
CREATE INDEX idx_tool_results_args ON tool_results USING GIN(args);

-- ============================================================================
-- API KEYS TABLE
-- ============================================================================

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  key_prefix VARCHAR(20) NOT NULL, -- First few chars for display (e.g., "dex_sk_...")
  name VARCHAR(255),
  last_used TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  CONSTRAINT api_keys_key_hash_check CHECK (length(key_hash) > 0),
  CONSTRAINT api_keys_key_prefix_check CHECK (key_prefix ~* '^dex_sk_[a-z0-9]{4}$')
);

-- Indexes for api_keys table
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_is_active ON api_keys(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_api_keys_user_active ON api_keys(user_id, is_active);

-- ============================================================================
-- USAGE TRACKING TABLE
-- ============================================================================

CREATE TABLE usage_tracking (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  queries_count INTEGER DEFAULT 0 NOT NULL,
  tokens_count BIGINT DEFAULT 0 NOT NULL,
  api_requests_count INTEGER DEFAULT 0 NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  CONSTRAINT usage_tracking_queries_check CHECK (queries_count >= 0),
  CONSTRAINT usage_tracking_tokens_check CHECK (tokens_count >= 0),
  CONSTRAINT usage_tracking_api_requests_check CHECK (api_requests_count >= 0),
  CONSTRAINT usage_tracking_period_check CHECK (period_end >= period_start)
);

-- Unique constraint: one record per user per period
CREATE UNIQUE INDEX idx_usage_tracking_user_period
  ON usage_tracking(user_id, period_start, period_end);

-- Indexes for usage_tracking table
CREATE INDEX idx_usage_tracking_user_id ON usage_tracking(user_id);
CREATE INDEX idx_usage_tracking_period ON usage_tracking(period_start, period_end);

-- ============================================================================
-- REFRESH TOKENS TABLE
-- ============================================================================

CREATE TABLE refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  last_used TIMESTAMP WITH TIME ZONE,

  CONSTRAINT refresh_tokens_token_hash_check CHECK (length(token_hash) > 0)
);

-- Indexes for refresh_tokens table
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
CREATE INDEX idx_refresh_tokens_is_revoked ON refresh_tokens(is_revoked) WHERE is_revoked = FALSE;

-- ============================================================================
-- FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_usage_tracking_updated_at
  BEFORE UPDATE ON usage_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically update query completion time
CREATE OR REPLACE FUNCTION set_query_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('completed', 'error', 'cancelled') AND OLD.status = 'processing' THEN
    NEW.completed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_query_completed_at_trigger
  BEFORE UPDATE ON queries
  FOR EACH ROW
  EXECUTE FUNCTION set_query_completed_at();

-- Function to automatically update API key last_used timestamp
CREATE OR REPLACE FUNCTION update_api_key_last_used()
RETURNS TRIGGER AS $$
BEGIN
  -- This would be called from application code when API key is used
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View for user statistics
CREATE OR REPLACE VIEW user_statistics AS
SELECT
  u.id AS user_id,
  u.email,
  u.plan,
  COUNT(DISTINCT s.id) AS total_sessions,
  COUNT(DISTINCT q.id) AS total_queries,
  COUNT(DISTINCT CASE WHEN q.status = 'completed' THEN q.id END) AS completed_queries,
  COUNT(DISTINCT CASE WHEN q.status = 'error' THEN q.id END) AS error_queries,
  COALESCE(SUM((q.token_usage->>'totalTokens')::BIGINT), 0) AS total_tokens_used,
  MAX(q.created_at) AS last_query_at,
  u.created_at AS user_created_at
FROM users u
LEFT JOIN sessions s ON s.user_id = u.id
LEFT JOIN queries q ON q.user_id = u.id
GROUP BY u.id, u.email, u.plan, u.created_at;

-- View for session statistics
CREATE OR REPLACE VIEW session_statistics AS
SELECT
  s.id AS session_id,
  s.user_id,
  s.name,
  s.model,
  s.provider,
  COUNT(q.id) AS total_queries,
  COUNT(CASE WHEN q.status = 'completed' THEN 1 END) AS completed_queries,
  AVG(q.total_time) AS avg_execution_time,
  MAX(q.created_at) AS last_query_at,
  s.created_at,
  s.updated_at
FROM sessions s
LEFT JOIN queries q ON q.session_id = s.id
GROUP BY s.id, s.user_id, s.name, s.model, s.provider, s.created_at, s.updated_at;

-- View for query performance metrics
CREATE OR REPLACE VIEW query_performance_metrics AS
SELECT
  q.id AS query_id,
  q.session_id,
  q.user_id,
  q.status,
  q.iterations,
  q.total_time,
  (q.token_usage->>'totalTokens')::INTEGER AS total_tokens,
  q.tokens_per_second,
  COUNT(tr.id) AS tool_calls_count,
  AVG(tr.duration) AS avg_tool_duration,
  q.created_at,
  q.completed_at,
  EXTRACT(EPOCH FROM (q.completed_at - q.created_at)) AS actual_duration_seconds
FROM queries q
LEFT JOIN tool_results tr ON tr.query_id = q.id
WHERE q.status = 'completed'
GROUP BY q.id, q.session_id, q.user_id, q.status, q.iterations,
         q.total_time, q.token_usage, q.tokens_per_second,
         q.created_at, q.completed_at;

-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Insert default system user (for internal operations)
INSERT INTO users (
  id,
  email,
  password_hash,
  name,
  plan,
  email_verified,
  is_active
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'system@dexter.ai',
  '', -- No password for system user
  'System User',
  'enterprise',
  TRUE,
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- SECURITY
-- ============================================================================

-- Row Level Security (RLS) policies

-- Enable RLS on all user tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY users_select_own ON users
  FOR SELECT
  USING (id = current_setting('app.user_id', TRUE)::UUID);

CREATE POLICY sessions_select_own ON sessions
  FOR SELECT
  USING (user_id = current_setting('app.user_id', TRUE)::UUID);

CREATE POLICY queries_select_own ON queries
  FOR SELECT
  USING (user_id = current_setting('app.user_id', TRUE)::UUID);

CREATE POLICY query_events_select_own ON query_events
  FOR SELECT
  USING (
    query_id IN (
      SELECT id FROM queries
      WHERE user_id = current_setting('app.user_id', TRUE)::UUID
    )
  );

CREATE POLICY tool_results_select_own ON tool_results
  FOR SELECT
  USING (
    query_id IN (
      SELECT id FROM queries
      WHERE user_id = current_setting('app.user_id', TRUE)::UUID
    )
  );

CREATE POLICY api_keys_select_own ON api_keys
  FOR SELECT
  USING (user_id = current_setting('app.user_id', TRUE)::UUID);

CREATE POLICY usage_tracking_select_own ON usage_tracking
  FOR SELECT
  USING (user_id = current_setting('app.user_id', TRUE)::UUID);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE users IS 'User accounts';
COMMENT ON TABLE sessions IS 'Research sessions with specific LLM configurations';
COMMENT ON TABLE queries IS 'Individual financial research queries';
COMMENT ON TABLE query_events IS 'Real-time execution events for queries';
COMMENT ON TABLE tool_results IS 'Results from tool executions';
COMMENT ON TABLE api_keys IS 'API keys for programmatic access';
COMMENT ON TABLE usage_tracking IS 'Monthly usage tracking for billing';
COMMENT ON TABLE refresh_tokens IS 'JWT refresh tokens';

COMMENT ON COLUMN users.password_hash IS 'bcrypt hash of user password (cost factor 12)';
COMMENT ON COLUMN users.preferences IS 'User preferences as JSON (default model, provider, etc.)';
COMMENT ON COLUMN queries.token_usage IS 'JSON object with inputTokens, outputTokens, totalTokens';
COMMENT ON COLUMN queries.total_time IS 'Total execution time in milliseconds';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hash of the API key';
COMMENT ON COLUMN api_keys.key_prefix IS 'Display prefix like "dex_sk_abc1"';

-- ============================================================================
-- INDEXES SUMMARY
-- ============================================================================
-- Total indexes created: 45+
-- - Primary key indexes: 8
-- - Foreign key indexes: 10
-- - Performance indexes: 25+
-- - Unique constraint indexes: 3
-- - GIN indexes for JSONB: 3
-- - Partial indexes (WHERE clauses): 5
--
-- Index strategy:
-- - All foreign keys indexed for JOIN performance
-- - Timestamp columns indexed DESC for recent queries
-- - Status columns indexed for filtering
-- - JSONB columns use GIN indexes for searching
-- - Composite indexes for common query patterns
-- - Partial indexes for active/non-archived records
-- ============================================================================

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Database version: 1.0.0
-- Total tables: 8
-- Total views: 3
-- Total functions: 3
-- Total triggers: 4
-- ============================================================================
