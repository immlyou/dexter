# Dexter Backend API

High-performance Web API for Dexter Financial Research Agent built with Bun, Hono, and Drizzle ORM.

## Features

- **Authentication** - JWT + Refresh Token authentication
- **Session Management** - Create and manage research sessions
- **Query Execution** - Submit queries and track execution
- **Real-time Updates** - WebSocket streaming for live query progress
- **Agent Integration** - Reuses 80% of existing Dexter agent code
- **Type Safety** - Full TypeScript with Zod validation
- **Performance** - Bun runtime with Hono framework (140k+ req/s)
- **Database** - PostgreSQL with Drizzle ORM
- **Docker Ready** - Complete containerization with docker-compose

## Tech Stack

- **Runtime**: Bun 1.3+
- **Framework**: Hono 4.11
- **Database**: PostgreSQL 16
- **ORM**: Drizzle ORM 0.45
- **Validation**: Zod 4.3
- **Authentication**: JWT + bcrypt

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Required: POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET (see .env.example)
export ANTHROPIC_API_KEY=your_key_here

# Start all services (pending database migrations run automatically at container start)
docker-compose up -d

# View logs
docker-compose logs -f api
```

The API listens on `http://127.0.0.1:8000` (loopback only). Put a TLS reverse proxy in
front of it and set `TRUST_PROXY_HOPS` to the number of proxies; set `API_BIND_ADDRESS=0.0.0.0`
only if the API must be reachable directly.

### Upgrading and migrations

The container runs `bun src/db/migrate.ts` before starting the server (`RUN_MIGRATIONS=0`
disables this, e.g. when several replicas start at once; then run `bun db:migrate` once
yourself before starting the new version).

- **Migration `0001_refresh_token_jti` logs everyone out.** It deletes all stored refresh
  tokens (they were stored in a format that can no longer be verified), so every user must
  sign in again after the upgrade. Announce this before deploying. Stop old API instances
  before migrating: they would keep writing rows the migration cannot convert.
- Migration `0002_refresh_token_rotation_meta` adds rotation metadata and is non-disruptive.

### Local Development

```bash
# Install dependencies
bun install

# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
bun db:migrate

# Start development server with hot reload
bun dev
```

## Environment Variables

Create a `.env` file:

```bash
# Server
PORT=8000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://dexter:dexter123@localhost:5432/dexter

# JWT
JWT_SECRET=your-secret-key-change-in-production
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d

# CORS
CORS_ORIGIN=http://localhost:3000

# LLM API Keys
ANTHROPIC_API_KEY=your_key
OPENAI_API_KEY=your_key
GOOGLE_API_KEY=your_key
FINANCIAL_DATASETS_API_KEY=your_key
EXASEARCH_API_KEY=your_key
```

## API Documentation

See [API-USAGE.md](./API-USAGE.md) for complete API documentation with examples.

### Base URL
- **Development**: `http://localhost:8000`
- **WebSocket**: `ws://localhost:8000/stream`

### Quick Example

```bash
# 1. Register user
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123","name":"Test User"}'

# 2. Create session
curl -X POST http://localhost:8000/api/sessions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Analysis","model":"claude-sonnet-4-5","provider":"anthropic"}'

# 3. Submit query
curl -X POST http://localhost:8000/api/queries \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"SESSION_ID","query":"What is Apple'\''s revenue?"}'
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user

### Sessions
- `POST /api/sessions` - Create session
- `GET /api/sessions` - List sessions
- `GET /api/sessions/:id` - Get session details
- `PATCH /api/sessions/:id` - Update session
- `DELETE /api/sessions/:id` - Delete session

### Queries
- `POST /api/queries` - Submit query
- `GET /api/queries/:id` - Get query status
- `GET /api/queries/:id/events` - Get query events
- `DELETE /api/queries/:id` - Cancel query
- `GET /api/queries` - List queries

### WebSocket
- `ws://localhost:8000/stream` - Real-time query updates

## Database Management

```bash
# Generate migration from schema changes
bun db:generate

# Run migrations
bun db:migrate

# Open Drizzle Studio (database GUI)
bun db:studio
```

## Project Structure

```
backend/
├── src/
│   ├── db/
│   │   ├── schema/          # Drizzle schema definitions
│   │   ├── client.ts        # Database client
│   │   └── migrate.ts       # Migration runner
│   ├── middleware/          # Auth middleware
│   ├── routes/              # API route handlers
│   ├── services/            # Business logic
│   │   ├── auth.service.ts
│   │   ├── session.service.ts
│   │   ├── query.service.ts
│   │   └── agent.service.ts # Agent integration
│   ├── types/               # Type definitions
│   ├── websocket/           # WebSocket handlers
│   ├── index.ts             # Hono app setup
│   └── server.ts            # Bun server entry
├── drizzle/                 # Generated migrations
├── docker-compose.yml       # Docker services
├── Dockerfile               # Multi-stage build
└── package.json
```

## Testing

```bash
# Run test script
./test-auth.sh

# Open WebSocket test client
open test-websocket.html
```

See [TEST-SETUP.md](./TEST-SETUP.md) for complete testing guide.

## Development Scripts

```bash
bun dev           # Start dev server with hot reload
bun start         # Start production server
bun db:generate   # Generate migration
bun db:migrate    # Run migrations
bun db:studio     # Open Drizzle Studio
bun typecheck     # Run TypeScript checks
bun test          # Run tests
```

## Docker Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f api

# Run migrations in container
docker-compose exec api bun db:migrate

# Rebuild images
docker-compose build --no-cache

# Shell into container
docker-compose exec api sh
```

## Performance

- **Framework**: Hono achieves 140k+ requests/second on Bun
- **Runtime**: Bun is 3-4x faster than Node.js
- **Database**: Native Bun.sql driver for PostgreSQL
- **WebSocket**: Bun native WebSocket (no Socket.io overhead)

## Architecture

The backend reuses 80% of the existing Dexter agent code by:

1. Importing `Agent` class from parent `../src/agent/agent.js`
2. Wrapping with `agent.service.ts` for database integration
3. Streaming events via WebSocket to connected clients
4. Storing all events and results in PostgreSQL

## Troubleshooting

### Database Connection Issues
```bash
# Check PostgreSQL status
docker-compose ps

# View PostgreSQL logs
docker-compose logs postgres

# Restart database
docker-compose restart postgres
```

### Migration Issues
```bash
# Check current schema
bun db:studio

# Regenerate migration
bun db:generate

# Apply migrations
bun db:migrate
```

### WebSocket Issues
- Ensure server is running
- Check JWT token is valid
- Verify CORS settings in .env
- Check browser console for errors

## Security

Refresh tokens rotate on every use. Token issuance, rotation and revoke-all are serialized
per user (row lock). Replaying an already-rotated refresh token revokes all of the user's
sessions, except within `REFRESH_REUSE_GRACE_SECONDS` (default 20s) of the rotation, where
the API answers `409 REFRESH_RETRY` so a second browser tab can pick up the new tokens.
Expired refresh tokens, and revoked ones older than `REVOKED_TOKEN_RETENTION_SECONDS`
(default 7 days), are deleted hourly.

The PostgreSQL integration test for these races is opt-in:
`TEST_DATABASE_URL=postgres://… bun test src/services/refreshToken.integration.test.ts`
(it migrates and writes to that database; use a disposable one).

- Passwords hashed with bcrypt (12 rounds)
- JWT tokens expire after 15 minutes
- Refresh tokens expire after 30 days
- Tokens stored securely (refresh tokens hashed)
- CORS protection enabled
- Input validation with Zod schemas

## Production Deployment

1. Set `NODE_ENV=production`
2. Use strong `JWT_SECRET`
3. Configure proper `CORS_ORIGIN`
4. Set up PostgreSQL database (Neon, RDS, etc.)
5. Set all required API keys
6. Run migrations: `bun db:migrate`
7. Build and deploy container

## License

MIT

## Support

For issues and questions:
- GitHub Issues: https://github.com/your-org/dexter
- Documentation: See API-USAGE.md and TEST-SETUP.md
