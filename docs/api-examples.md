# Dexter API 使用範例

本文檔提供完整的 API 使用範例,涵蓋所有主要端點。

---

## 目錄
1. [認證流程](#認證流程)
2. [會話管理](#會話管理)
3. [查詢執行](#查詢執行)
4. [WebSocket 實時事件](#websocket-實時事件)
5. [用戶管理](#用戶管理)
6. [錯誤處理](#錯誤處理)

---

## 認證流程

### 1. 用戶註冊

```bash
curl -X POST https://api.dexter.ai/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePass123",
    "name": "John Doe"
  }'
```

**響應** (201 Created):
```json
{
  "userId": "usr_abc123",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "ref_xyz789",
  "user": {
    "id": "usr_abc123",
    "email": "john@example.com",
    "name": "John Doe",
    "plan": "free",
    "createdAt": "2026-02-11T10:00:00Z"
  }
}
```

### 2. 用戶登入

```bash
curl -X POST https://api.dexter.ai/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePass123"
  }'
```

**響應** (200 OK):
```json
{
  "userId": "usr_abc123",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "ref_xyz789",
  "user": {
    "id": "usr_abc123",
    "email": "john@example.com",
    "name": "John Doe",
    "plan": "free"
  }
}
```

### 3. 刷新 Token

```bash
curl -X POST https://api.dexter.ai/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "ref_xyz789"
  }'
```

**響應** (200 OK):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "ref_new123"
}
```

---

## 會話管理

**注意**: 所有後續請求需要包含 Authorization header

```bash
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 1. 創建會話

```bash
curl -X POST https://api.dexter.ai/api/sessions \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tech Stock Analysis",
    "model": "claude-sonnet-4-5",
    "provider": "anthropic",
    "maxIterations": 10
  }'
```

**響應** (201 Created):
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

### 2. 列出會話

```bash
curl -X GET "https://api.dexter.ai/api/sessions?limit=20&sort=updatedAt&order=desc" \
  -H "Authorization: Bearer ${TOKEN}"
```

**響應** (200 OK):
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
    },
    {
      "sessionId": "ses_def456",
      "name": "Market Research",
      "model": "gpt-5.2",
      "provider": "openai",
      "queryCount": 3,
      "createdAt": "2026-02-10T14:00:00Z",
      "updatedAt": "2026-02-10T15:45:00Z"
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

### 3. 獲取會話詳情

```bash
curl -X GET https://api.dexter.ai/api/sessions/ses_abc123 \
  -H "Authorization: Bearer ${TOKEN}"
```

**響應** (200 OK):
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
    },
    {
      "queryId": "qry_abc456",
      "queryText": "Compare Microsoft and Google revenue",
      "status": "processing",
      "createdAt": "2026-02-11T11:20:00Z"
    }
  ],
  "createdAt": "2026-02-11T10:00:00Z",
  "updatedAt": "2026-02-11T11:30:00Z"
}
```

### 4. 更新會話

```bash
curl -X PATCH https://api.dexter.ai/api/sessions/ses_abc123 \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Session Name",
    "model": "gpt-5.2",
    "provider": "openai"
  }'
```

**響應** (200 OK):
```json
{
  "sessionId": "ses_abc123",
  "name": "Updated Session Name",
  "model": "gpt-5.2",
  "provider": "openai",
  "updatedAt": "2026-02-11T12:00:00Z"
}
```

### 5. 刪除會話

```bash
curl -X DELETE https://api.dexter.ai/api/sessions/ses_abc123 \
  -H "Authorization: Bearer ${TOKEN}"
```

**響應** (204 No Content)

---

## 查詢執行

### 1. 提交查詢

```bash
curl -X POST https://api.dexter.ai/api/queries \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "ses_abc123",
    "query": "What is Apple'\''s revenue growth over the past 5 years?"
  }'
```

**響應** (201 Created):
```json
{
  "queryId": "qry_xyz789",
  "sessionId": "ses_abc123",
  "queryText": "What is Apple's revenue growth over the past 5 years?",
  "status": "processing",
  "createdAt": "2026-02-11T10:15:00Z",
  "streamUrl": "wss://api.dexter.ai/stream?queryId=qry_xyz789&token=eyJ..."
}
```

### 2. 獲取查詢結果

```bash
curl -X GET https://api.dexter.ai/api/queries/qry_xyz789 \
  -H "Authorization: Bearer ${TOKEN}"
```

**響應** (200 OK) - 處理中:
```json
{
  "queryId": "qry_xyz789",
  "sessionId": "ses_abc123",
  "queryText": "What is Apple's revenue growth over the past 5 years?",
  "status": "processing",
  "createdAt": "2026-02-11T10:15:00Z"
}
```

**響應** (200 OK) - 已完成:
```json
{
  "queryId": "qry_xyz789",
  "sessionId": "ses_abc123",
  "queryText": "What is Apple's revenue growth over the past 5 years?",
  "status": "completed",
  "answer": "Apple's revenue has grown significantly over the past 5 years:\n\n- FY2020: $274.5B\n- FY2021: $365.8B (+33%)\n- FY2022: $394.3B (+8%)\n- FY2023: $383.3B (-3%)\n- FY2024: $391.0B (+2%)\n\nOverall growth from 2020 to 2024: +42%\n\nThe company saw strong growth in 2020-2021, slight decline in 2023 due to economic headwinds, and recovery in 2024.",
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

### 3. 獲取查詢事件

```bash
curl -X GET "https://api.dexter.ai/api/queries/qry_xyz789/events?limit=100" \
  -H "Authorization: Bearer ${TOKEN}"
```

**響應** (200 OK):
```json
{
  "queryId": "qry_xyz789",
  "events": [
    {
      "eventId": "evt_001",
      "type": "thinking",
      "data": {
        "message": "I need to fetch Apple's annual revenue data for the past 5 years..."
      },
      "timestamp": "2026-02-11T10:15:01Z"
    },
    {
      "eventId": "evt_002",
      "type": "tool_start",
      "data": {
        "tool": "financial_search",
        "args": {
          "query": "Apple revenue 2020-2024 annual"
        }
      },
      "timestamp": "2026-02-11T10:15:02Z"
    },
    {
      "eventId": "evt_003",
      "type": "tool_progress",
      "data": {
        "tool": "financial_search",
        "message": "Fetching from Income Statements..."
      },
      "timestamp": "2026-02-11T10:15:03Z"
    },
    {
      "eventId": "evt_004",
      "type": "tool_end",
      "data": {
        "tool": "financial_search",
        "args": {
          "query": "Apple revenue 2020-2024 annual"
        },
        "result": "{\"data\":{\"get_income_statements_AAPL\":[{\"fiscal_year\":2024,\"revenue\":391035000000},{\"fiscal_year\":2023,\"revenue\":383285000000}...]}}",
        "duration": 2500
      },
      "timestamp": "2026-02-11T10:15:04Z"
    },
    {
      "eventId": "evt_005",
      "type": "answer_start",
      "data": {},
      "timestamp": "2026-02-11T10:15:10Z"
    },
    {
      "eventId": "evt_006",
      "type": "done",
      "data": {
        "answer": "Apple's revenue has grown significantly...",
        "toolCalls": [...],
        "iterations": 3,
        "totalTime": 12500,
        "tokenUsage": {
          "inputTokens": 2500,
          "outputTokens": 800,
          "totalTokens": 3300
        }
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

### 4. 取消查詢

```bash
curl -X DELETE https://api.dexter.ai/api/queries/qry_xyz789 \
  -H "Authorization: Bearer ${TOKEN}"
```

**響應** (200 OK):
```json
{
  "queryId": "qry_xyz789",
  "status": "cancelled",
  "message": "Query execution cancelled successfully"
}
```

---

## WebSocket 實時事件

### JavaScript/TypeScript 示例

```typescript
import { io } from 'socket.io-client'

// 1. 建立 WebSocket 連接
const socket = io('wss://api.dexter.ai', {
  auth: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  }
})

// 2. 監聽連接事件
socket.on('connect', () => {
  console.log('Connected to WebSocket server')
})

socket.on('connect_error', (error) => {
  console.error('Connection error:', error.message)
})

// 3. 提交查詢 (通過 REST API)
const response = await fetch('https://api.dexter.ai/api/queries', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    sessionId: 'ses_abc123',
    query: "What is Apple's revenue growth?"
  })
})

const { queryId } = await response.json()
console.log('Query submitted:', queryId)

// 4. 訂閱查詢事件
socket.emit('subscribe', { queryId })

socket.on('subscribed', (data) => {
  console.log('Subscribed to query:', data.queryId)
})

// 5. 監聽實時事件
socket.on('event', (data) => {
  console.log(`[${data.event.type}]`, data.event)

  switch (data.event.type) {
    case 'thinking':
      console.log('Agent thinking:', data.event.message)
      break

    case 'tool_start':
      console.log(`Tool started: ${data.event.tool}`)
      console.log('Args:', data.event.args)
      break

    case 'tool_progress':
      console.log(`Progress: ${data.event.message}`)
      break

    case 'tool_end':
      console.log(`Tool completed: ${data.event.tool}`)
      console.log(`Duration: ${data.event.duration}ms`)
      break

    case 'tool_error':
      console.error(`Tool error: ${data.event.error}`)
      break

    case 'answer_start':
      console.log('Generating final answer...')
      break

    case 'done':
      console.log('Query completed!')
      console.log('Answer:', data.event.answer)
      console.log('Iterations:', data.event.iterations)
      console.log('Total time:', data.event.totalTime, 'ms')
      console.log('Tokens used:', data.event.tokenUsage.totalTokens)

      // 取消訂閱
      socket.emit('unsubscribe', { queryId })
      break
  }
})

// 6. 錯誤處理
socket.on('error', (error) => {
  console.error('WebSocket error:', error)
})

// 7. 取消查詢 (可選)
function cancelQuery() {
  socket.emit('cancel', { queryId })
}

socket.on('cancelled', (data) => {
  console.log('Query cancelled:', data.queryId)
})
```

### Python 示例

```python
import socketio
import requests

# 1. 建立 Socket.IO 客戶端
sio = socketio.Client()

@sio.on('connect')
def on_connect():
    print('Connected to WebSocket server')

@sio.on('subscribed')
def on_subscribed(data):
    print(f"Subscribed to query: {data['queryId']}")

@sio.on('event')
def on_event(data):
    event = data['event']
    event_type = event['type']

    print(f"[{event_type}]", event)

    if event_type == 'done':
        print('Answer:', event['answer'])
        print('Iterations:', event['iterations'])
        sio.emit('unsubscribe', {'queryId': data['queryId']})

@sio.on('error')
def on_error(error):
    print('Error:', error)

# 2. 連接到服務器
token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
sio.connect('wss://api.dexter.ai', auth={'token': token})

# 3. 提交查詢
response = requests.post(
    'https://api.dexter.ai/api/queries',
    headers={
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    },
    json={
        'sessionId': 'ses_abc123',
        'query': "What is Apple's revenue growth?"
    }
)

query_id = response.json()['queryId']
print(f'Query submitted: {query_id}')

# 4. 訂閱查詢事件
sio.emit('subscribe', {'queryId': query_id})

# 5. 等待完成
sio.wait()
```

---

## 用戶管理

### 1. 獲取當前用戶信息

```bash
curl -X GET https://api.dexter.ai/api/users/me \
  -H "Authorization: Bearer ${TOKEN}"
```

**響應** (200 OK):
```json
{
  "userId": "usr_abc123",
  "email": "john@example.com",
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
  "preferences": {
    "defaultModel": "claude-sonnet-4-5",
    "defaultProvider": "anthropic"
  },
  "createdAt": "2026-01-15T10:00:00Z"
}
```

### 2. 更新用戶信息

```bash
curl -X PATCH https://api.dexter.ai/api/users/me \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Updated",
    "preferences": {
      "defaultModel": "gpt-5.2",
      "defaultProvider": "openai"
    }
  }'
```

**響應** (200 OK):
```json
{
  "userId": "usr_abc123",
  "email": "john@example.com",
  "name": "John Updated",
  "preferences": {
    "defaultModel": "gpt-5.2",
    "defaultProvider": "openai"
  },
  "updatedAt": "2026-02-11T12:00:00Z"
}
```

### 3. 創建 API Key

```bash
curl -X POST https://api.dexter.ai/api/users/me/api-keys \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production CLI Key",
    "expiresIn": 2592000
  }'
```

**響應** (201 Created):
```json
{
  "keyId": "key_abc123",
  "key": "dex_sk_live_abc123def456ghi789jkl012mno345pqr678stu901vwx234",
  "name": "Production CLI Key",
  "expiresAt": "2026-03-11T12:00:00Z",
  "createdAt": "2026-02-11T12:00:00Z"
}
```

**⚠️ 重要**: API key 只在創建時顯示一次,請妥善保存!

### 4. 使用 API Key 認證

```bash
# 使用 API Key 代替 JWT Token
curl -X GET https://api.dexter.ai/api/sessions \
  -H "X-API-Key: dex_sk_live_abc123def456ghi789jkl012mno345pqr678stu901vwx234"
```

### 5. 刪除 API Key

```bash
curl -X DELETE https://api.dexter.ai/api/users/me/api-keys/key_abc123 \
  -H "Authorization: Bearer ${TOKEN}"
```

**響應** (204 No Content)

---

## 錯誤處理

### 驗證錯誤 (400 Bad Request)

```bash
curl -X POST https://api.dexter.ai/api/queries \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "invalid-uuid",
    "query": ""
  }'
```

**響應** (400):
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": {
      "sessionId": "Invalid UUID format",
      "query": "Query text is required and cannot be empty"
    },
    "timestamp": "2026-02-11T12:00:00Z",
    "requestId": "req_abc123"
  }
}
```

### 認證錯誤 (401 Unauthorized)

```bash
curl -X GET https://api.dexter.ai/api/sessions \
  -H "Authorization: Bearer invalid_token"
```

**響應** (401):
```json
{
  "error": {
    "code": "AUTH_INVALID_TOKEN",
    "message": "Invalid or malformed authentication token",
    "timestamp": "2026-02-11T12:00:00Z",
    "requestId": "req_abc123"
  }
}
```

### 資源不存在 (404 Not Found)

```bash
curl -X GET https://api.dexter.ai/api/queries/nonexistent_id \
  -H "Authorization: Bearer ${TOKEN}"
```

**響應** (404):
```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Query not found",
    "details": {
      "queryId": "nonexistent_id"
    },
    "timestamp": "2026-02-11T12:00:00Z",
    "requestId": "req_abc123"
  }
}
```

### 速率限制 (429 Too Many Requests)

```bash
# 超過速率限制後
curl -X POST https://api.dexter.ai/api/queries \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

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
    "timestamp": "2026-02-11T12:00:00Z",
    "requestId": "req_abc123"
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

## 完整工作流程範例

### 場景: 完整的查詢執行流程

```bash
#!/bin/bash

# 1. 設置變量
API_BASE="https://api.dexter.ai"
EMAIL="john@example.com"
PASSWORD="SecurePass123"

# 2. 登入獲取 token
echo "Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "${API_BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

TOKEN=$(echo $LOGIN_RESPONSE | jq -r '.token')
echo "Token obtained: ${TOKEN:0:20}..."

# 3. 創建會話
echo "Creating session..."
SESSION_RESPONSE=$(curl -s -X POST "${API_BASE}/api/sessions" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Stock Analysis",
    "model": "claude-sonnet-4-5",
    "provider": "anthropic"
  }')

SESSION_ID=$(echo $SESSION_RESPONSE | jq -r '.sessionId')
echo "Session created: ${SESSION_ID}"

# 4. 提交查詢
echo "Submitting query..."
QUERY_RESPONSE=$(curl -s -X POST "${API_BASE}/api/queries" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"sessionId\": \"${SESSION_ID}\",
    \"query\": \"What is Apple's revenue growth over the past 5 years?\"
  }")

QUERY_ID=$(echo $QUERY_RESPONSE | jq -r '.queryId')
echo "Query submitted: ${QUERY_ID}"

# 5. 輪詢查詢狀態 (或使用 WebSocket)
echo "Waiting for completion..."
while true; do
  RESULT=$(curl -s -X GET "${API_BASE}/api/queries/${QUERY_ID}" \
    -H "Authorization: Bearer ${TOKEN}")

  STATUS=$(echo $RESULT | jq -r '.status')
  echo "Status: ${STATUS}"

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "error" ]; then
    break
  fi

  sleep 2
done

# 6. 獲取結果
if [ "$STATUS" = "completed" ]; then
  echo "Query completed!"
  echo $RESULT | jq -r '.answer'
else
  echo "Query failed:"
  echo $RESULT | jq -r '.errorMessage'
fi

# 7. 獲取執行事件
echo "Fetching events..."
curl -s -X GET "${API_BASE}/api/queries/${QUERY_ID}/events" \
  -H "Authorization: Bearer ${TOKEN}" | jq
```

---

## Postman Collection

完整的 Postman Collection 可以從 OpenAPI 規範生成:

1. 導入 `/Users/chris-m4/dexter/docs/openapi.yaml`
2. Postman 會自動生成所有端點
3. 設置環境變量:
   - `baseUrl`: https://api.dexter.ai
   - `token`: (登入後獲取)
   - `sessionId`: (創建會話後獲取)

---

## 更多資源

- **API 規範**: `/docs/api-spec.md`
- **OpenAPI 規範**: `/docs/openapi.yaml`
- **數據庫 Schema**: `/docs/database-migrations.sql`
- **框架對比**: `/docs/framework-comparison.md`
