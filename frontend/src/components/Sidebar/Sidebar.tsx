import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useSessions, useCreateSession } from '../../hooks/useSessions';
import { useModels } from '../../hooks/useModels';

export default function Sidebar() {
  const currentSession = useSessionStore((state) => state.currentSession);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const clearMessages = useSessionStore((state) => state.clearMessages);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);

  // Fetch sessions from API
  const { sessions, isLoading: loadingSessions } = useSessions({
    sort: 'updatedAt',
    order: 'desc',
  });

  // Fetch models for creating new sessions
  const { models, isLoading: loadingModels } = useModels();

  // Create session mutation
  const { mutate: createSession, isPending: creatingSession } = useCreateSession();

  const handleNewChat = () => {
    // Get the first available model (or use a default)
    const defaultModel = models.find((m) => m.provider === 'anthropic' && m.id === 'claude-sonnet-4-5') ||
                         models[0];

    if (!defaultModel) {
      console.error('No models available');
      return;
    }

    createSession(
      {
        name: `New Chat ${new Date().toLocaleString()}`,
        model: defaultModel.id,
        provider: defaultModel.provider,
        config: {},
      },
      {
        onSuccess: (newSession) => {
          setCurrentSession(newSession);
          clearMessages();
        },
        onError: (error) => {
          console.error('Failed to create session:', error);
        },
      }
    );
  };

  return (
    <div className="h-full bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Dexter</h1>
          <button
            onClick={toggleSidebar}
            className="p-1 hover:bg-gray-700 rounded"
            title="Close sidebar"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <button
          onClick={handleNewChat}
          disabled={creatingSession || loadingModels}
          className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {creatingSession ? 'Creating...' : '+ New Chat'}
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto p-2">
        {loadingSessions ? (
          <div className="text-gray-400 text-sm text-center mt-4">
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-gray-400 text-sm text-center mt-4">
            No sessions yet
          </div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => {
                setCurrentSession(session);
                clearMessages();
              }}
              className={`
                w-full p-3 mb-2 rounded-lg text-left transition-colors
                ${
                  currentSession?.id === session.id
                    ? 'bg-gray-700'
                    : 'hover:bg-gray-800'
                }
              `}
            >
              <div className="text-sm font-medium truncate">
                {session.name || session.model}
              </div>
              <div className="text-xs text-gray-400 flex justify-between">
                <span>{session.model}</span>
                <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700">
        <div className="text-xs text-gray-400">
          <div>Model: {currentSession?.model || 'Not selected'}</div>
          <div>Provider: {currentSession?.provider || 'Not selected'}</div>
        </div>
      </div>
    </div>
  );
}
