# Dexter Web Frontend

Web interface for Dexter - the autonomous financial research AI agent.

## Tech Stack

- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite 7
- **Styling**: TailwindCSS 4
- **State Management**: Zustand
- **Data Fetching**: TanStack Query (React Query)
- **Markdown**: React Markdown + remark-gfm
- **Code Highlighting**: React Syntax Highlighter

## Project Structure

```
src/
├── components/
│   ├── Chat/              # Chat interface components
│   │   ├── ChatInterface.tsx
│   │   ├── MessageList.tsx
│   │   ├── MessageItem.tsx
│   │   ├── UserMessageView.tsx
│   │   ├── AgentMessageView.tsx
│   │   ├── InputBox.tsx
│   │   ├── Header.tsx
│   │   └── WorkingIndicator.tsx
│   │
│   ├── Sidebar/           # Sidebar components
│   │   └── Sidebar.tsx
│   │
│   ├── Agent/             # Agent event display
│   │   ├── AgentEventList.tsx
│   │   └── AgentEventItem.tsx
│   │
│   ├── Shared/            # Shared components (TODO)
│   └── MainLayout.tsx     # Main app layout
│
├── hooks/                 # Custom React hooks
│   ├── useAuth.ts         # Authentication management
│   ├── useModels.ts       # Model queries
│   ├── useSessions.ts     # Session management
│   └── useQuery.ts        # Query execution + real-time stream
│
├── services/              # API services
│   ├── api.ts             # REST API client
│   └── websocket.ts       # WebSocket client (Socket.io)
├── stores/                # Zustand stores
│   ├── sessionStore.ts
│   └── uiStore.ts
├── types/                 # TypeScript type definitions
│   ├── index.ts           # Component types and Agent events
│   └── api.ts             # API request/response types
└── utils/                 # Utility functions (TODO)
```

## Features Implemented

### Phase 1: Project Setup ✅
- Vite + React + TypeScript project
- TailwindCSS configuration
- Directory structure
- Core dependencies installed

### Phase 2: Static UI Components ✅
- Main layout with sidebar toggle
- Sidebar with session list
- Chat interface with header
- Message display (user/agent)
- Input box with keyboard shortcuts
- Agent event visualization (CLI-style)
- Working indicator
- Markdown rendering support

### Phase 3: State Management ✅
- Zustand stores for sessions and UI state
- Message management
- Processing state tracking

### Phase 4: API Integration ✅
- REST API client with automatic token refresh
- WebSocket client for real-time event streaming
- Custom React hooks for all API operations
- Complete type definitions matching OpenAPI schema
- Environment configuration (.env files)

## Development Status

**Current Status**: Phase 4 Complete (API Integration Ready)

**Completed**:
- ✅ Project setup and configuration
- ✅ Static UI components (11 components)
- ✅ State management (Zustand stores)
- ✅ API integration layer (REST + WebSocket)
- ✅ Custom hooks for all features
- ✅ Type-safe API client

**Next Steps**:
- Connect UI components to real API
- Add authentication pages (Login/Register)
- Implement session switching
- Test with live backend API
- Error handling UI improvements

## Available Scripts

```bash
# Install dependencies
bun install

# Start development server
bun dev

# Build for production
bun run build

# Preview production build
bun preview

# Type checking
bun run tsc --noEmit
```

## Environment Setup

1. Copy `.env.example` to `.env.development`:
```bash
cp .env.example .env.development
```

2. Configure API endpoints:
```env
VITE_API_BASE_URL=http://localhost:3000
VITE_WS_BASE_URL=ws://localhost:3000
```

3. For production, create `.env.production`:
```env
VITE_API_BASE_URL=https://api.dexter.ai
VITE_WS_BASE_URL=wss://api.dexter.ai
```

## Design Principles

1. **CLI-Inspired UX**: Maintains the visual style of the original CLI interface
   - Uses "⏺" symbols for tool calls
   - Shows real-time agent execution steps
   - Clear distinction between user and agent messages

2. **Modern Chat Interface**: Similar to ChatGPT/Claude.ai
   - Left sidebar for session management
   - Center chat area with smooth scrolling
   - Bottom-fixed input box

3. **Real-time Updates**: Designed for WebSocket streaming
   - Progressive event display
   - Live status indicators
   - Smooth animations

## UI/UX Features

- 📱 Responsive design (mobile-friendly)
- 🎨 Clean, modern interface
- ⚡ Real-time agent status updates
- 📝 Markdown support for rich content
- 🔍 Code syntax highlighting
- ⌨️ Keyboard shortcuts (Enter to send, Shift+Enter for new line)
- 💬 Session history management
- 🎯 Tool call visualization

## Integration with Backend

The frontend is fully integrated with the backend API:

### REST Endpoints (Implemented)
- **Auth**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/refresh`
- **Sessions**: `GET /api/sessions`, `POST /api/sessions`, `GET /api/sessions/:id`, `PATCH /api/sessions/:id`, `DELETE /api/sessions/:id`
- **Queries**: `POST /api/queries`, `GET /api/queries/:id`, `DELETE /api/queries/:id`, `GET /api/queries/:id/events`
- **Models**: `GET /api/models`, `GET /api/models/:provider/:modelId`
- **Users**: `GET /api/users/me`, `PATCH /api/users/me`, `POST /api/users/me/api-keys`, `DELETE /api/users/me/api-keys/:keyId`
- **Health**: `GET /api/health`

### WebSocket (Implemented)
- Connection: `wss://api.dexter.ai/stream` with JWT auth
- Events: `subscribe`, `unsubscribe`, `cancel`
- Real-time events: `thinking`, `tool_start`, `tool_end`, `done`, etc.

### Features
- ✅ Automatic JWT token refresh
- ✅ Request/response interceptors
- ✅ WebSocket auto-reconnection
- ✅ React Query caching
- ✅ Error handling and retry logic

## Development Notes

- All components use TypeScript for type safety
- Follows React best practices and hooks patterns
- Uses Tailwind utility classes for styling
- Prepared for easy API integration
- Mock data structure matches expected backend format

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## License

MIT
