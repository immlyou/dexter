# Dexter Web API 設計文檔

## 文檔版本
- **版本**: 1.0
- **日期**: 2026-02-11
- **作者**: 後端開發專員

---

## 目錄
1. [概述](#1-概述)
2. [架構設計](#2-架構設計)
3. [認證機制](#3-認證機制)
4. [REST API 端點](#4-rest-api-端點)
5. [WebSocket API](#5-websocket-api)
6. [數據模型](#6-數據模型)
7. [錯誤處理](#7-錯誤處理)
8. [速率限制](#8-速率限制)
9. [安全性](#9-安全性)
10. [OpenAPI 規範](#10-openapi-規範)

---

## 1. 概述

### 1.1 目標
將 Dexter CLI 應用轉換為 RESTful Web API，保留所有核心功能，支援多用戶、會話管理和實時事件流。

### 1.2 核心功能
- 金融研究查詢執行
- 實時執行步驟追蹤
- 多 LLM 模型支援
- 會話管理和歷史記錄
- WebSocket 實時事件流

### 1.3 技術棧
- **API 框架**: Hono (高性能，Bun 原生優化，TypeScript 優先)
- **運行時**: Bun (原生 WebSocket，高性能)
- **資料庫**: PostgreSQL (Bun.sql 原生支援)
- **WebSocket**: Bun 原生 WebSocket (內建支援)
- **認證**: JWT + API Keys
- **驗證**: Zod schemas
- **ORM**: Drizzle ORM (TypeScript-first)

---

## 2. 架構設計

### 2.1 系統架構

```
┌─────────────────────────────────────────────┐
│           Client Applications               │
│    (Web Browser, Mobile App, CLI)          │
└──────────────┬──────────────────────────────┘
               │ HTTPS / WSS
┌──────────────▼──────────────────────────────┐
│           API Gateway / Load Balancer       │
│         (Nginx / Cloudflare)                │
└──────────────┬──────────────────────────────┘
               │
┌──────────────▼──────────────────────────────┐
│         Fastify API Server                  │
│  ┌──────────────────────────────────────┐  │
│  │  REST Endpoints                       │  │
│  │  - Session Management                 │  │
│  │  - Query Execution                    │  │
│  │  - Model Configuration                │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │  WebSocket Server (Socket.io)        │  │
│  │  - Real-time Event Streaming          │  │
│  └──────────────────────────────────────┘  │
└──────────────┬──────────────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌─────────────┐    ┌─────────────┐
│ PostgreSQL  │    │   Redis     │
│ (Persistent)│    │  (Cache)    │
└─────────────┘    └─────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│         Agent Service Layer                 │
│  ┌──────────────────────────────────────┐  │
│  │  Agent Execution (Reused Code)       │  │
│  │  - Agent.run()                        │  │
│  │  - Tool Registry                      │  │
│  │  - LLM Abstraction                    │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 2.2 請求流程

#### 查詢執行流程
```
Client
  ↓ POST /api/queries
API Server
  ↓ 創建查詢記錄
PostgreSQL
  ↓ 返回 queryId
Client
  ↓ 建立 WebSocket 連接
WebSocket Server
  ↓ 開始執行
Agent Service
  ↓ 產生事件流
WebSocket
  ↓ 推送事件
Client (實時接收)
```

---

## 3. 認證機制

### 3.1 認證方式

支援兩種認證方式:

#### JWT Token (用戶認證)
```
Authorization: Bearer <jwt_token>
```

用於:
- 用戶註冊/登入後的會話
- 訪問個人資源
- WebSocket 連接認證

#### API Key (服務認證)
```
X-API-Key: <api_key>
```

用於:
- 第三方服務集成
- CLI 工具
- 自動化腳本

### 3.2 JWT Payload

```typescript
interface JWTPayload {
  userId: string
  email: string
  plan: 'free' | 'pro' | 'enterprise'
  iat: number  // issued at
  exp: number  // expiry
}
```

### 3.3 認證流程

```
POST /api/auth/register
  → { email, password }
  ← { userId, token, refreshToken }

POST /api/auth/login
  → { email, password }
  ← { userId, token, refreshToken }

POST /api/auth/refresh
  → { refreshToken }
  ← { token, refreshToken }

POST /api/auth/logout
  → { refreshToken }
  ← { success: true }
```

---

## 4. REST API 端點

### 4.1 認證端點

#### POST /api/auth/register
註冊新用戶

**請求**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "John Doe"
}
```

**響應** (201):
```json
{
  "userId": "usr_abc123",
  "token": "eyJhbGc...",
  "refreshToken": "ref_xyz789",
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "name": "John Doe",
    "plan": "free",
    "createdAt": "2026-02-11T10:00:00Z"
  }
}
```

#### POST /api/auth/login
用戶登入

**請求**:
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**響應** (200):
```json
{
  "userId": "usr_abc123",
  "token": "eyJhbGc...",
  "refreshToken": "ref_xyz789",
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "name": "John Doe",
    "plan": "free"
  }
}
```

---

### 4.2 會話管理

#### POST /api/sessions
創建新會話

**請求**:
```json
{
  "name": "Tech Stock Analysis",
  "model": "claude-sonnet-4-5",
  "provider": "anthropic",
  "maxIterations": 10
}
```

**響應** (201):
```json
{
  "sessionId": "ses_abc123",
  "name": "Tech Stock Analysis",
  "model": "claude-sonnet-4-5",
  "provider": "anthropic",
  "config": {
    "maxIterations": 10
  },
  "createdAt": "2026-02-11T10:00:00Z",
  "updatedAt": "2026-02-11T10:00:00Z"
}
```

#### GET /api/sessions
列出用戶的所有會話

**查詢參數**:
- `limit` (default: 20, max: 100)
- `offset` (default: 0)
- `sort` (default: "updatedAt", values: "createdAt" | "updatedAt")
- `order` (default: "desc", values: "asc" | "desc")

**響應** (200):
```json
{
  "sessions": [
    {
      "sessionId": "ses_abc123",
      "name": "Tech Stock Analysis",
      "model": "claude-sonnet-4-5",
      "provider": "anthropic",
      "queryCount": 5,
      "createdAt": "2026-02-11T10:00:00Z",
      "updatedAt": "2026-02-11T11:30:00Z"
    }
  ],
  "pagination": {
    "total": 15,
    "limit": 20,
    "offset": 0,
    "hasMore": false
  }
}
```

#### GET /api/sessions/:sessionId
獲取會話詳情

**響應** (200):
```json
{
  "sessionId": "ses_abc123",
  "name": "Tech Stock Analysis",
  "model": "claude-sonnet-4-5",
  "provider": "anthropic",
  "config": {
    "maxIterations": 10
  },
  "queries": [
    {
      "queryId": "qry_xyz789",
      "queryText": "What is Apple's revenue growth?",
      "status": "completed",
      "createdAt": "2026-02-11T10:15:00Z"
    }
  ],
  "createdAt": "2026-02-11T10:00:00Z",
  "updatedAt": "2026-02-11T11:30:00Z"
}
```

#### PATCH /api/sessions/:sessionId
更新會話配置

**請求**:
```json
{
  "name": "Updated Session Name",
  "model": "gpt-5.2",
  "provider": "openai"
}
```

**響應** (200):
```json
{
  "sessionId": "ses_abc123",
  "name": "Updated Session Name",
  "model": "gpt-5.2",
  "provider": "openai",
  "updatedAt": "2026-02-11T12:00:00Z"
}
```

#### DELETE /api/sessions/:sessionId
刪除會話

**響應** (204):
```
No Content
```

---

### 4.3 查詢執行

#### POST /api/queries
提交新查詢

**請求**:
```json
{
  "sessionId": "ses_abc123",
  "query": "What is Apple's revenue growth over the past 5 years?"
}
```

**響應** (201):
```json
{
  "queryId": "qry_xyz789",
  "sessionId": "ses_abc123",
  "queryText": "What is Apple's revenue growth over the past 5 years?",
  "status": "processing",
  "createdAt": "2026-02-11T10:15:00Z",
  "streamUrl": "wss://api.dexter.ai/stream?queryId=qry_xyz789&token=..."
}
```

**狀態值**:
- `processing` - 正在執行
- `completed` - 已完成
- `error` - 執行錯誤
- `cancelled` - 已取消

#### GET /api/queries/:queryId
獲取查詢狀態和結果

**響應** (200):
```json
{
  "queryId": "qry_xyz789",
  "sessionId": "ses_abc123",
  "queryText": "What is Apple's revenue growth over the past 5 years?",
  "status": "completed",
  "answer": "Apple's revenue has grown from $274B in 2020 to $394B in 2024...",
  "iterations": 3,
  "totalTime": 12500,
  "tokenUsage": {
    "inputTokens": 2500,
    "outputTokens": 800,
    "totalTokens": 3300
  },
  "tokensPerSecond": 64.5,
  "createdAt": "2026-02-11T10:15:00Z",
  "completedAt": "2026-02-11T10:15:12Z"
}
```

#### GET /api/queries/:queryId/events
獲取查詢的所有執行事件

**查詢參數**:
- `limit` (default: 100)
- `offset` (default: 0)

**響應** (200):
```json
{
  "queryId": "qry_xyz789",
  "events": [
    {
      "eventId": "evt_001",
      "type": "thinking",
      "data": {
        "message": "Planning research approach..."
      },
      "timestamp": "2026-02-11T10:15:01Z"
    },
    {
      "eventId": "evt_002",
      "type": "tool_start",
      "data": {
        "tool": "financial_search",
        "args": {
          "query": "Apple revenue 2020-2024"
        }
      },
      "timestamp": "2026-02-11T10:15:02Z"
    },
    {
      "eventId": "evt_003",
      "type": "tool_end",
      "data": {
        "tool": "financial_search",
        "result": "{\"data\":{...}}",
        "duration": 2500
      },
      "timestamp": "2026-02-11T10:15:04Z"
    },
    {
      "eventId": "evt_004",
      "type": "done",
      "data": {
        "answer": "Apple's revenue has grown...",
        "toolCalls": [...],
        "iterations": 3,
        "totalTime": 12500
      },
      "timestamp": "2026-02-11T10:15:12Z"
    }
  ],
  "pagination": {
    "total": 8,
    "limit": 100,
    "offset": 0
  }
}
```

#### DELETE /api/queries/:queryId
取消正在執行的查詢

**響應** (200):
```json
{
  "queryId": "qry_xyz789",
  "status": "cancelled",
  "message": "Query execution cancelled successfully"
}
```

---

### 4.4 模型管理

#### GET /api/models
列出所有可用的 LLM 模型

**響應** (200):
```json
{
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "models": [
        {
          "id": "gpt-5.2",
          "name": "GPT-5.2",
          "capabilities": ["chat", "tools"],
          "contextWindow": 128000
        },
        {
          "id": "gpt-4.1",
          "name": "GPT-4.1",
          "capabilities": ["chat", "tools"],
          "contextWindow": 32000
        }
      ]
    },
    {
      "id": "anthropic",
      "name": "Anthropic",
      "models": [
        {
          "id": "claude-sonnet-4-5",
          "name": "Claude Sonnet 4.5",
          "capabilities": ["chat", "tools", "cache"],
          "contextWindow": 200000
        }
      ]
    }
  ]
}
```

#### GET /api/models/:provider/:modelId
獲取特定模型的詳細信息

**響應** (200):
```json
{
  "id": "claude-sonnet-4-5",
  "name": "Claude Sonnet 4.5",
  "provider": "anthropic",
  "capabilities": ["chat", "tools", "cache"],
  "contextWindow": 200000,
  "pricing": {
    "input": 3.00,
    "output": 15.00,
    "unit": "per million tokens"
  },
  "description": "Anthropic's most capable model..."
}
```

---

### 4.5 用戶管理

#### GET /api/users/me
獲取當前用戶信息

**響應** (200):
```json
{
  "userId": "usr_abc123",
  "email": "user@example.com",
  "name": "John Doe",
  "plan": "free",
  "usage": {
    "queriesThisMonth": 45,
    "queriesLimit": 100,
    "tokensThisMonth": 250000,
    "tokensLimit": 1000000
  },
  "apiKeys": [
    {
      "keyId": "key_xyz789",
      "name": "My CLI Key",
      "lastUsed": "2026-02-11T09:00:00Z",
      "createdAt": "2026-02-01T10:00:00Z"
    }
  ],
  "createdAt": "2026-01-15T10:00:00Z"
}
```

#### PATCH /api/users/me
更新用戶信息

**請求**:
```json
{
  "name": "John Updated",
  "preferences": {
    "defaultModel": "claude-sonnet-4-5",
    "defaultProvider": "anthropic"
  }
}
```

**響應** (200):
```json
{
  "userId": "usr_abc123",
  "email": "user@example.com",
  "name": "John Updated",
  "preferences": {
    "defaultModel": "claude-sonnet-4-5",
    "defaultProvider": "anthropic"
  },
  "updatedAt": "2026-02-11T12:00:00Z"
}
```

#### POST /api/users/me/api-keys
創建新的 API Key

**請求**:
```json
{
  "name": "Production CLI Key",
  "expiresIn": 2592000
}
```

**響應** (201):
```json
{
  "keyId": "key_abc123",
  "key": "dex_sk_live_abc123def456...",
  "name": "Production CLI Key",
  "expiresAt": "2026-03-11T12:00:00Z",
  "createdAt": "2026-02-11T12:00:00Z"
}
```

**⚠️ 重要**: API key 只在創建時顯示一次

#### DELETE /api/users/me/api-keys/:keyId
刪除 API Key

**響應** (204):
```
No Content
```

---

### 4.6 健康檢查和統計

#### GET /api/health
健康檢查端點

**響應** (200):
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2026-02-11T12:00:00Z",
  "services": {
    "database": "healthy",
    "redis": "healthy",
    "llm": "healthy"
  }
}
```

#### GET /api/stats
獲取系統統計信息 (需要管理員權限)

**響應** (200):
```json
{
  "users": {
    "total": 1250,
    "active": 340
  },
  "queries": {
    "total": 45600,
    "today": 1234,
    "processing": 23
  },
  "tokens": {
    "total": 125000000,
    "today": 3500000
  }
}
```

---

## 5. WebSocket API

### 5.1 連接建立

#### 連接 URL
```
wss://api.dexter.ai/stream
```

#### 認證
通過查詢參數傳遞 token:
```
wss://api.dexter.ai/stream?token=<jwt_token>
```

或通過握手時的 header:
```javascript
const socket = io('wss://api.dexter.ai', {
  auth: {
    token: 'jwt_token_here'
  }
});
```

### 5.2 事件類型

#### 客戶端 → 服務器

##### subscribe
訂閱查詢的事件流

**發送**:
```json
{
  "type": "subscribe",
  "queryId": "qry_xyz789"
}
```

**確認**:
```json
{
  "type": "subscribed",
  "queryId": "qry_xyz789",
  "status": "processing"
}
```

##### unsubscribe
取消訂閱

**發送**:
```json
{
  "type": "unsubscribe",
  "queryId": "qry_xyz789"
}
```

##### cancel
取消查詢執行

**發送**:
```json
{
  "type": "cancel",
  "queryId": "qry_xyz789"
}
```

**確認**:
```json
{
  "type": "cancelled",
  "queryId": "qry_xyz789"
}
```

#### 服務器 → 客戶端

##### event
實時執行事件

**事件格式**:
```json
{
  "type": "event",
  "queryId": "qry_xyz789",
  "event": {
    "type": "thinking" | "tool_start" | "tool_progress" | "tool_end" | "tool_error" | "answer_start" | "done",
    "data": { ... }
  },
  "timestamp": "2026-02-11T10:15:01Z"
}
```

**事件類型詳細**:

1. **thinking** - Agent 思考過程
```json
{
  "type": "event",
  "queryId": "qry_xyz789",
  "event": {
    "type": "thinking",
    "message": "Planning research approach for Apple revenue analysis..."
  },
  "timestamp": "2026-02-11T10:15:01Z"
}
```

2. **tool_start** - 工具開始執行
```json
{
  "type": "event",
  "queryId": "qry_xyz789",
  "event": {
    "type": "tool_start",
    "tool": "financial_search",
    "args": {
      "query": "Apple revenue 2020-2024"
    }
  },
  "timestamp": "2026-02-11T10:15:02Z"
}
```

3. **tool_progress** - 工具執行進度
```json
{
  "type": "event",
  "queryId": "qry_xyz789",
  "event": {
    "type": "tool_progress",
    "tool": "financial_search",
    "message": "Fetching from Income Statements..."
  },
  "timestamp": "2026-02-11T10:15:03Z"
}
```

4. **tool_end** - 工具執行完成
```json
{
  "type": "event",
  "queryId": "qry_xyz789",
  "event": {
    "type": "tool_end",
    "tool": "financial_search",
    "args": {
      "query": "Apple revenue 2020-2024"
    },
    "result": "{\"data\":{...}}",
    "duration": 2500
  },
  "timestamp": "2026-02-11T10:15:04Z"
}
```

5. **tool_error** - 工具執行錯誤
```json
{
  "type": "event",
  "queryId": "qry_xyz789",
  "event": {
    "type": "tool_error",
    "tool": "financial_search",
    "error": "API rate limit exceeded"
  },
  "timestamp": "2026-02-11T10:15:04Z"
}
```

6. **answer_start** - 開始生成答案
```json
{
  "type": "event",
  "queryId": "qry_xyz789",
  "event": {
    "type": "answer_start"
  },
  "timestamp": "2026-02-11T10:15:10Z"
}
```

7. **done** - 執行完成
```json
{
  "type": "event",
  "queryId": "qry_xyz789",
  "event": {
    "type": "done",
    "answer": "Apple's revenue has grown from $274B in 2020...",
    "toolCalls": [
      {
        "tool": "financial_search",
        "args": { "query": "Apple revenue 2020-2024" },
        "result": "{...}"
      }
    ],
    "iterations": 3,
    "totalTime": 12500,
    "tokenUsage": {
      "inputTokens": 2500,
      "outputTokens": 800,
      "totalTokens": 3300
    },
    "tokensPerSecond": 64.5
  },
  "timestamp": "2026-02-11T10:15:12Z"
}
```

##### error
錯誤通知

```json
{
  "type": "error",
  "queryId": "qry_xyz789",
  "error": {
    "code": "EXECUTION_ERROR",
    "message": "Agent execution failed",
    "details": "..."
  },
  "timestamp": "2026-02-11T10:15:12Z"
}
```

##### connection_error
連接錯誤

```json
{
  "type": "connection_error",
  "error": {
    "code": "AUTH_FAILED",
    "message": "Invalid or expired token"
  }
}
```

### 5.3 完整流程示例

```javascript
// 1. 建立連接
const socket = io('wss://api.dexter.ai', {
  auth: { token: userToken }
});

// 2. 監聽連接事件
socket.on('connect', () => {
  console.log('Connected to WebSocket');
});

// 3. 提交查詢 (通過 REST API)
const response = await fetch('https://api.dexter.ai/api/queries', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    sessionId: 'ses_abc123',
    query: 'What is Apple\'s revenue growth?'
  })
});
const { queryId } = await response.json();

// 4. 訂閱查詢事件
socket.emit('subscribe', { queryId });

// 5. 監聽事件
socket.on('event', (data) => {
  console.log(`Event: ${data.event.type}`, data.event);

  if (data.event.type === 'done') {
    console.log('Answer:', data.event.answer);
    socket.emit('unsubscribe', { queryId });
  }
});

// 6. 錯誤處理
socket.on('error', (error) => {
  console.error('Error:', error);
});

// 7. 取消查詢 (可選)
// socket.emit('cancel', { queryId });
```

---

## 6. 數據模型

### 6.1 數據庫 Schema

#### Users 表
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  plan VARCHAR(50) DEFAULT 'free',
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
```

#### Sessions 表
```sql
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255),
  model VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);
```

#### Queries 表
```sql
CREATE TABLE queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  status VARCHAR(50) NOT NULL, -- processing, completed, error, cancelled
  answer TEXT,
  iterations INTEGER,
  total_time INTEGER, -- milliseconds
  token_usage JSONB,
  tokens_per_second DECIMAL(10,2),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_queries_session_id ON queries(session_id);
CREATE INDEX idx_queries_user_id ON queries(user_id);
CREATE INDEX idx_queries_status ON queries(status);
CREATE INDEX idx_queries_created_at ON queries(created_at DESC);
```

#### Query Events 表
```sql
CREATE TABLE query_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_query_events_query_id ON query_events(query_id);
CREATE INDEX idx_query_events_timestamp ON query_events(timestamp);
```

#### Tool Results 表
```sql
CREATE TABLE tool_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  tool_name VARCHAR(100) NOT NULL,
  args JSONB NOT NULL,
  result TEXT NOT NULL,
  duration INTEGER, -- milliseconds
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tool_results_query_id ON tool_results(query_id);
```

#### API Keys 表
```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  last_used TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
```

#### Usage Tracking 表
```sql
CREATE TABLE usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  queries_count INTEGER DEFAULT 0,
  tokens_count BIGINT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_usage_tracking_user_period
  ON usage_tracking(user_id, period_start, period_end);
```

### 6.2 TypeScript 接口

```typescript
// User
interface User {
  id: string
  email: string
  name?: string
  plan: 'free' | 'pro' | 'enterprise'
  preferences: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

// Session
interface Session {
  id: string
  userId: string
  name?: string
  model: string
  provider: string
  config: {
    maxIterations?: number
    [key: string]: unknown
  }
  createdAt: Date
  updatedAt: Date
}

// Query
interface Query {
  id: string
  sessionId: string
  userId: string
  queryText: string
  status: 'processing' | 'completed' | 'error' | 'cancelled'
  answer?: string
  iterations?: number
  totalTime?: number
  tokenUsage?: TokenUsage
  tokensPerSecond?: number
  errorMessage?: string
  createdAt: Date
  completedAt?: Date
}

// Token Usage
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

// Query Event
interface QueryEvent {
  id: string
  queryId: string
  eventType: string
  eventData: AgentEvent
  timestamp: Date
}

// Tool Result
interface ToolResult {
  id: string
  queryId: string
  toolName: string
  args: Record<string, unknown>
  result: string
  duration?: number
  createdAt: Date
}

// API Key
interface APIKey {
  id: string
  userId: string
  name?: string
  lastUsed?: Date
  expiresAt?: Date
  createdAt: Date
}
```

---

## 7. 錯誤處理

### 7.1 錯誤響應格式

所有錯誤響應使用統一格式:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional context"
    },
    "timestamp": "2026-02-11T12:00:00Z",
    "requestId": "req_abc123"
  }
}
```

### 7.2 HTTP 狀態碼

| 狀態碼 | 說明 | 使用場景 |
|--------|------|----------|
| 200 | OK | 成功的 GET/PATCH 請求 |
| 201 | Created | 成功創建資源 |
| 204 | No Content | 成功刪除資源 |
| 400 | Bad Request | 請求格式錯誤或驗證失敗 |
| 401 | Unauthorized | 未認證或 token 無效 |
| 403 | Forbidden | 已認證但無權限 |
| 404 | Not Found | 資源不存在 |
| 409 | Conflict | 資源衝突 (如重複註冊) |
| 422 | Unprocessable Entity | 請求格式正確但邏輯錯誤 |
| 429 | Too Many Requests | 超出速率限制 |
| 500 | Internal Server Error | 服務器內部錯誤 |
| 502 | Bad Gateway | 上游服務錯誤 |
| 503 | Service Unavailable | 服務暫時不可用 |

### 7.3 錯誤代碼

#### 認證錯誤 (AUTH_*)
- `AUTH_REQUIRED` - 需要認證
- `AUTH_INVALID_TOKEN` - Token 無效
- `AUTH_EXPIRED_TOKEN` - Token 已過期
- `AUTH_INVALID_CREDENTIALS` - 登入憑證錯誤
- `AUTH_INSUFFICIENT_PERMISSIONS` - 權限不足

#### 驗證錯誤 (VALIDATION_*)
- `VALIDATION_FAILED` - 輸入驗證失敗
- `VALIDATION_MISSING_FIELD` - 缺少必填字段
- `VALIDATION_INVALID_FORMAT` - 格式錯誤

#### 資源錯誤 (RESOURCE_*)
- `RESOURCE_NOT_FOUND` - 資源不存在
- `RESOURCE_ALREADY_EXISTS` - 資源已存在
- `RESOURCE_CONFLICT` - 資源衝突

#### 執行錯誤 (EXECUTION_*)
- `EXECUTION_FAILED` - 執行失敗
- `EXECUTION_TIMEOUT` - 執行超時
- `EXECUTION_CANCELLED` - 執行已取消

#### 速率限制錯誤 (RATE_LIMIT_*)
- `RATE_LIMIT_EXCEEDED` - 超出速率限制
- `QUOTA_EXCEEDED` - 超出配額

#### 系統錯誤 (SYSTEM_*)
- `SYSTEM_ERROR` - 系統內部錯誤
- `SYSTEM_UNAVAILABLE` - 系統暫時不可用
- `SYSTEM_MAINTENANCE` - 系統維護中

### 7.4 錯誤示例

#### 驗證錯誤
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": {
      "query": "Query text is required",
      "sessionId": "Invalid UUID format"
    },
    "timestamp": "2026-02-11T12:00:00Z",
    "requestId": "req_abc123"
  }
}
```

#### 認證錯誤
```json
{
  "error": {
    "code": "AUTH_EXPIRED_TOKEN",
    "message": "Authentication token has expired",
    "details": {
      "expiredAt": "2026-02-11T10:00:00Z"
    },
    "timestamp": "2026-02-11T12:00:00Z",
    "requestId": "req_abc123"
  }
}
```

#### 速率限制錯誤
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "details": {
      "limit": 100,
      "remaining": 0,
      "resetAt": "2026-02-11T13:00:00Z"
    },
    "timestamp": "2026-02-11T12:00:00Z",
    "requestId": "req_abc123"
  }
}
```

---

## 8. 速率限制

### 8.1 限制策略

使用 Token Bucket 算法實現速率限制。

#### 免費方案
- **API 請求**: 100 requests / 小時
- **查詢執行**: 10 queries / 天
- **Token 使用**: 1M tokens / 月

#### Pro 方案
- **API 請求**: 1000 requests / 小時
- **查詢執行**: 100 queries / 天
- **Token 使用**: 10M tokens / 月

#### Enterprise 方案
- **自定義限制**

### 8.2 速率限制 Headers

所有響應包含速率限制信息:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 75
X-RateLimit-Reset: 1707652800
```

### 8.3 超出限制響應

**響應** (429):
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "details": {
      "limit": 100,
      "remaining": 0,
      "resetAt": "2026-02-11T13:00:00Z",
      "retryAfter": 3600
    },
    "timestamp": "2026-02-11T12:00:00Z"
  }
}
```

**Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1707652800
Retry-After: 3600
```

---

## 9. 安全性

### 9.1 HTTPS Only
所有 API 端點僅通過 HTTPS 訪問。HTTP 請求自動重定向到 HTTPS。

### 9.2 CORS 配置

允許的來源:
- `https://dexter.ai`
- `https://*.dexter.ai`
- `http://localhost:3000` (開發環境)

CORS Headers:
```
Access-Control-Allow-Origin: https://dexter.ai
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, X-API-Key
Access-Control-Max-Age: 86400
```

### 9.3 密碼安全

- 使用 bcrypt 加密，cost factor = 12
- 密碼最小長度: 8 字符
- 必須包含大小寫字母、數字

### 9.4 Token 安全

- JWT 有效期: 15 分鐘
- Refresh Token 有效期: 30 天
- API Keys 支援設置過期時間
- 所有 tokens 使用安全隨機生成

### 9.5 輸入驗證

- 所有輸入使用 Zod schemas 驗證
- 防止 SQL 注入 (使用參數化查詢)
- 防止 XSS (輸出轉義)
- 限制請求大小 (最大 10MB)

### 9.6 API Key 管理

- API Keys 加密存儲 (使用 SHA-256 hash)
- 僅在創建時顯示完整 key
- 支援立即撤銷
- 記錄使用日誌

---

## 10. OpenAPI 規範

### 10.1 基本信息

```yaml
openapi: 3.0.3
info:
  title: Dexter API
  version: 1.0.0
  description: |
    Dexter 金融研究 AI Agent API

    ## 認證
    支援兩種認證方式:
    - JWT Token (用戶認證)
    - API Key (服務認證)

    ## 速率限制
    根據用戶方案不同有不同的限制

  contact:
    name: API Support
    email: api@dexter.ai
    url: https://docs.dexter.ai
  license:
    name: MIT
    url: https://opensource.org/licenses/MIT

servers:
  - url: https://api.dexter.ai
    description: Production server
  - url: https://staging.api.dexter.ai
    description: Staging server
  - url: http://localhost:3000
    description: Development server

tags:
  - name: Auth
    description: 認證相關端點
  - name: Sessions
    description: 會話管理
  - name: Queries
    description: 查詢執行
  - name: Models
    description: 模型管理
  - name: Users
    description: 用戶管理

components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key

  schemas:
    User:
      type: object
      properties:
        userId:
          type: string
          format: uuid
        email:
          type: string
          format: email
        name:
          type: string
        plan:
          type: string
          enum: [free, pro, enterprise]
        createdAt:
          type: string
          format: date-time

    Session:
      type: object
      properties:
        sessionId:
          type: string
          format: uuid
        userId:
          type: string
          format: uuid
        name:
          type: string
        model:
          type: string
        provider:
          type: string
        config:
          type: object
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time

    Query:
      type: object
      properties:
        queryId:
          type: string
          format: uuid
        sessionId:
          type: string
          format: uuid
        queryText:
          type: string
        status:
          type: string
          enum: [processing, completed, error, cancelled]
        answer:
          type: string
        iterations:
          type: integer
        totalTime:
          type: integer
        tokenUsage:
          $ref: '#/components/schemas/TokenUsage'
        createdAt:
          type: string
          format: date-time
        completedAt:
          type: string
          format: date-time

    TokenUsage:
      type: object
      properties:
        inputTokens:
          type: integer
        outputTokens:
          type: integer
        totalTokens:
          type: integer

    Error:
      type: object
      properties:
        error:
          type: object
          properties:
            code:
              type: string
            message:
              type: string
            details:
              type: object
            timestamp:
              type: string
              format: date-time
            requestId:
              type: string

security:
  - BearerAuth: []
  - ApiKeyAuth: []
```

### 10.2 完整規範文件

完整的 OpenAPI 3.0 規範文件可在以下位置獲取:
- `/Users/chris-m4/dexter-openapi.yaml` (將另外生成)

---

## 附錄

### A. 版本歷史

| 版本 | 日期 | 變更 |
|------|------|------|
| 1.0  | 2026-02-11 | 初始版本 |

### B. 待辦事項

- [ ] 完成 OpenAPI YAML 文件
- [ ] 添加 GraphQL API 支援 (可選)
- [ ] 實現 Webhook 通知
- [ ] 添加批量查詢 API
- [ ] 實現查詢模板功能

### C. 參考資料

- [Dexter 架構分析](./dexter-architecture-analysis.md)
- [Fastify 文檔](https://www.fastify.io/)
- [Socket.io 文檔](https://socket.io/docs/)
- [OpenAPI 規範](https://swagger.io/specification/)

---

**文檔結束**
