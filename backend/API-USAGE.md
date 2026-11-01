# Dexter Backend API - Usage Guide

## Quick Start

### 1. Setup

**Using Docker Compose (Recommended):**
```bash
# Set environment variables
export ANTHROPIC_API_KEY=your_key_here

# Start services
docker-compose up -d

# Run migrations
docker-compose exec api bun db:migrate

# View logs
docker-compose logs -f api
```

**Local Development:**
```bash
# Install dependencies
bun install

# Set environment variables
cp .env.example .env
# Edit .env with your configuration

# Run migrations
bun db:migrate

# Start server
bun dev
```

### 2. API Endpoints

**Base URL:** `http://localhost:8000`

**WebSocket:** `ws://localhost:8000/stream`

## Authentication

### Register User
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "name": "Test User"
  }'
```

**Response:**
```json
{
  "userId": "uuid",
  "token": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Test User",
    "plan": "free",
    "createdAt": "2026-02-11T..."
  }
}
```

### Login
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Get Current User
```bash
curl http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Refresh Token
```bash
curl -X POST http://localhost:8000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "YOUR_REFRESH_TOKEN"
  }'
```

## Sessions

### Create Session
```bash
curl -X POST http://localhost:8000/api/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tech Stock Analysis",
    "model": "claude-sonnet-4-5",
    "provider": "anthropic",
    "config": {
      "maxIterations": 10
    }
  }'
```

**Response:**
```json
{
  "sessionId": "uuid",
  "name": "Tech Stock Analysis",
  "model": "claude-sonnet-4-5",
  "provider": "anthropic",
  "config": {
    "maxIterations": 10
  },
  "createdAt": "2026-02-11T...",
  "updatedAt": "2026-02-11T..."
}
```

### List Sessions
```bash
curl "http://localhost:8000/api/sessions?limit=20&offset=0&sort=updatedAt&order=desc" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Session Details
```bash
curl http://localhost:8000/api/sessions/SESSION_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Update Session
```bash
curl -X PATCH http://localhost:8000/api/sessions/SESSION_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Name",
    "model": "gpt-5.2"
  }'
```

### Delete Session
```bash
curl -X DELETE http://localhost:8000/api/sessions/SESSION_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Queries

### Submit Query
```bash
curl -X POST http://localhost:8000/api/queries \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "SESSION_ID",
    "query": "What is Apple'\''s revenue growth over the past 5 years?"
  }'
```

**Response:**
```json
{
  "queryId": "uuid",
  "sessionId": "SESSION_ID",
  "queryText": "What is Apple's revenue growth...",
  "status": "processing",
  "createdAt": "2026-02-11T...",
  "streamUrl": "wss://localhost:8000/stream?queryId=uuid"
}
```

### Get Query Status
```bash
curl http://localhost:8000/api/queries/QUERY_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (completed):**
```json
{
  "queryId": "uuid",
  "sessionId": "SESSION_ID",
  "queryText": "What is Apple's revenue growth...",
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
  "createdAt": "2026-02-11T...",
  "completedAt": "2026-02-11T..."
}
```

### Get Query Events
```bash
curl "http://localhost:8000/api/queries/QUERY_ID/events?limit=100&offset=0" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Cancel Query
```bash
curl -X DELETE http://localhost:8000/api/queries/QUERY_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### List Queries
```bash
curl "http://localhost:8000/api/queries?sessionId=SESSION_ID&status=completed&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## WebSocket Real-time Updates

### Connect and Subscribe

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:8000/stream');

// Wait for connection
ws.onopen = () => {
  console.log('Connected');

  // Authenticate
  ws.send(JSON.stringify({
    type: 'authenticate',
    token: 'YOUR_JWT_TOKEN'
  }));
};

// Handle messages
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);

  if (data.type === 'authenticated') {
    // Now subscribe to query
    ws.send(JSON.stringify({
      type: 'subscribe',
      queryId: 'QUERY_ID'
    }));
  }

  if (data.type === 'event') {
    // Handle query event
    console.log('Query event:', data.event.type, data.event.data);

    if (data.event.type === 'done') {
      console.log('Answer:', data.event.data.answer);
    }
  }
};
```

### Event Types

1. **thinking** - Agent is thinking
   ```json
   {
     "type": "thinking",
     "message": "Planning research approach..."
   }
   ```

2. **tool_start** - Tool execution started
   ```json
   {
     "type": "tool_start",
     "tool": "financial_search",
     "args": { "query": "Apple revenue" }
   }
   ```

3. **tool_progress** - Tool progress update
   ```json
   {
     "type": "tool_progress",
     "tool": "financial_search",
     "message": "Fetching income statements..."
   }
   ```

4. **tool_end** - Tool execution completed
   ```json
   {
     "type": "tool_end",
     "tool": "financial_search",
     "result": "...",
     "duration": 2500
   }
   ```

5. **tool_error** - Tool execution failed
   ```json
   {
     "type": "tool_error",
     "tool": "financial_search",
     "error": "API rate limit exceeded"
   }
   ```

6. **answer_start** - Starting to generate answer
   ```json
   {
     "type": "answer_start"
   }
   ```

7. **done** - Query completed
   ```json
   {
     "type": "done",
     "answer": "Apple's revenue...",
     "toolCalls": [...],
     "iterations": 3,
     "totalTime": 12500,
     "tokenUsage": {...}
   }
   ```

## Complete Workflow Example

```bash
#!/bin/bash

# 1. Register
RESPONSE=$(curl -s -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","name":"Test"}')

TOKEN=$(echo $RESPONSE | jq -r '.token')
echo "Token: $TOKEN"

# 2. Create Session
SESSION=$(curl -s -X POST http://localhost:8000/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Analysis","model":"claude-sonnet-4-5","provider":"anthropic"}')

SESSION_ID=$(echo $SESSION | jq -r '.sessionId')
echo "Session ID: $SESSION_ID"

# 3. Submit Query
QUERY=$(curl -s -X POST http://localhost:8000/api/queries \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"query\":\"What is Apple's revenue?\"}")

QUERY_ID=$(echo $QUERY | jq -r '.queryId')
echo "Query ID: $QUERY_ID"

# 4. Poll for results
while true; do
  STATUS=$(curl -s http://localhost:8000/api/queries/$QUERY_ID \
    -H "Authorization: Bearer $TOKEN")

  QUERY_STATUS=$(echo $STATUS | jq -r '.status')
  echo "Status: $QUERY_STATUS"

  if [ "$QUERY_STATUS" = "completed" ] || [ "$QUERY_STATUS" = "error" ]; then
    echo $STATUS | jq '.answer'
    break
  fi

  sleep 2
done
```

## Error Handling

All errors follow this format:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "timestamp": "2026-02-11T..."
  }
}
```

Common error codes:
- `AUTH_REQUIRED` - No authentication provided
- `AUTH_INVALID_TOKEN` - Invalid JWT token
- `AUTH_EXPIRED_TOKEN` - JWT token expired
- `SESSION_NOT_FOUND` - Session doesn't exist
- `QUERY_NOT_FOUND` - Query doesn't exist
- `VALIDATION_FAILED` - Input validation error

## Rate Limiting

- Free tier: 100 API requests/hour
- Query limits based on plan
- Token usage tracked per user

## Environment Variables

```bash
# Server
PORT=8000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dexter

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d

# CORS
CORS_ORIGIN=https://your-frontend.com

# LLM API Keys
ANTHROPIC_API_KEY=your_key
OPENAI_API_KEY=your_key
GOOGLE_API_KEY=your_key
FINANCIAL_DATASETS_API_KEY=your_key
EXASEARCH_API_KEY=your_key
```

## Testing

Open `test-websocket.html` in your browser for interactive WebSocket testing.

Run the test script:
```bash
./test-auth.sh
```

## Troubleshooting

### Database Connection Issues
```bash
# Check if PostgreSQL is running
docker-compose ps

# View logs
docker-compose logs postgres

# Restart database
docker-compose restart postgres
```

### Migration Issues
```bash
# Generate new migration
bun db:generate

# Run migrations
bun db:migrate

# Open Drizzle Studio to inspect database
bun db:studio
```

### WebSocket Connection Issues
- Ensure server is running
- Check CORS settings
- Verify JWT token is valid
- Check browser console for errors

## Support

For issues and questions:
- GitHub Issues: https://github.com/your-org/dexter
- Documentation: https://docs.dexter.ai
