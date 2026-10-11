# Dexter Backend - Quick Start Guide

Get the backend running in under 5 minutes.

## Prerequisites

- Bun 1.3+ installed (`curl -fsSL https://bun.sh/install | bash`)
- PostgreSQL 16 (or use Docker)

## Option 1: Docker (Fastest)

```bash
# 1. Set required API key
export ANTHROPIC_API_KEY=your_key_here

# 2. Start everything
cd /Users/chris-m4/dexter/backend
docker-compose up -d

# 3. Run migrations
docker-compose exec api bun db:migrate

# 4. Test it
curl http://localhost:8000/health
```

Done! API running at `http://localhost:8000`

## Option 2: Local Development

```bash
# 1. Install dependencies
cd /Users/chris-m4/dexter/backend
bun install

# 2. Setup environment
cp .env.example .env
# Edit .env with your database URL and API keys

# 3. Setup database (if not using Docker)
createdb dexter

# 4. Run migrations
bun db:migrate

# 5. Start server
bun dev
```

Server running at `http://localhost:8000` with hot reload.

## Quick Test

```bash
# Register a user
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","name":"Test User"}'

# Save the token from response, then:
TOKEN="your_token_here"

# Create a session
curl -X POST http://localhost:8000/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","model":"claude-sonnet-4-5","provider":"anthropic"}'

# Save the sessionId, then:
SESSION_ID="your_session_id"

# Submit a query
curl -X POST http://localhost:8000/api/queries \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"query\":\"What is 2+2?\"}"

# Get query status
curl http://localhost:8000/api/queries/QUERY_ID \
  -H "Authorization: Bearer $TOKEN"
```

## Test WebSocket

```bash
# Open the test client
open test-websocket.html

# Or use from command line
cd /Users/chris-m4/dexter/backend
bun run dev
```

Then in the HTML client:
1. Connect to `ws://localhost:8000/stream`
2. Authenticate with your JWT token
3. Subscribe to a query ID
4. Watch real-time events!

## Environment Variables

Minimum required:
```env
DATABASE_URL=postgresql://dexter:dexter123@localhost:5432/dexter
JWT_SECRET=change-me-in-production
ANTHROPIC_API_KEY=your_key
```

## Common Commands

```bash
bun dev              # Start dev server
bun start            # Start production
bun db:migrate       # Run migrations
bun db:studio        # Open database GUI
bun typecheck        # Check TypeScript

docker-compose up -d         # Start all services
docker-compose logs -f api   # View logs
docker-compose down          # Stop all services
```

## API Endpoints

**Authentication:**
- POST `/api/auth/register` - Create account
- POST `/api/auth/login` - Login
- GET `/api/auth/me` - Get user info
- POST `/api/auth/refresh` - Refresh token
- POST `/api/auth/logout` - Logout

**Sessions:**
- POST `/api/sessions` - Create session
- GET `/api/sessions` - List sessions
- GET `/api/sessions/:id` - Get session
- PATCH `/api/sessions/:id` - Update session
- DELETE `/api/sessions/:id` - Delete session

**Queries:**
- POST `/api/queries` - Submit query
- GET `/api/queries/:id` - Get query
- GET `/api/queries/:id/events` - Get events
- DELETE `/api/queries/:id` - Cancel query
- GET `/api/queries` - List queries

**WebSocket:**
- WS `/stream` - Real-time events

## Troubleshooting

**Database connection error:**
```bash
# Check PostgreSQL is running
docker-compose ps
# or
pg_isready -h localhost

# Restart if needed
docker-compose restart postgres
```

**Migration error:**
```bash
# Check current schema
bun db:studio

# Regenerate if needed
bun db:generate
```

**TypeScript errors:**
```bash
# Check for errors
bun typecheck

# Backend should have 0 errors
# (Parent Dexter project may have errors but doesn't affect backend)
```

## Next Steps

- See [API-USAGE.md](./API-USAGE.md) for complete API documentation
- See [README.md](./README.md) for full features and architecture
- See [DEPLOYMENT.md](./DEPLOYMENT.md) for production deployment
- See [TEST-SETUP.md](./TEST-SETUP.md) for testing guide

## Support

- Check logs: `docker-compose logs -f api`
- Check database: `bun db:studio`
- Read docs: README.md, API-USAGE.md, DEPLOYMENT.md
- Issues: GitHub Issues

---

**That's it!** You now have a production-ready financial research API with real-time WebSocket streaming. 🚀
