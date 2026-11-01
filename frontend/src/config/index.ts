// Application configuration

// Feature flags
export const config = {
  // Use mock API and WebSocket for development
  useMockApi: import.meta.env.VITE_USE_MOCK_API === 'true',

  // API endpoints
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  wsBaseUrl: import.meta.env.VITE_WS_BASE_URL || 'ws://localhost:3000',

  // Debug mode
  debug: import.meta.env.VITE_ENABLE_DEBUG === 'true',
};

// Log config on startup
if (config.debug) {
  console.log('[Config]', config);
}
