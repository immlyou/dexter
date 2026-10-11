import { useState, KeyboardEvent } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useCreateQuery } from '../../hooks/useQuery';

interface InputBoxProps {
  disabled?: boolean;
}

export default function InputBox({ disabled = false }: InputBoxProps) {
  const [input, setInput] = useState('');
  const currentSession = useSessionStore((state) => state.currentSession);
  const addMessage = useSessionStore((state) => state.addMessage);
  const setProcessing = useSessionStore((state) => state.setProcessing);
  const setCurrentQueryId = useSessionStore((state) => state.setCurrentQueryId);

  const { mutate: createQuery, isPending } = useCreateQuery();

  const handleSubmit = () => {
    if (!input.trim() || disabled || isPending || !currentSession) return;

    const queryText = input.trim();

    // Add user message
    const userMessage = {
      id: Date.now().toString(),
      type: 'user' as const,
      content: queryText,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMessage);

    // Add placeholder agent message that will be updated with events
    const agentMessageId = (Date.now() + 1).toString();
    const agentMessage = {
      id: agentMessageId,
      type: 'agent' as const,
      content: '',
      events: [],
      status: 'processing' as const,
      timestamp: new Date().toISOString(),
    };
    addMessage(agentMessage);
    setProcessing(true);

    // Create query via API
    createQuery(
      {
        sessionId: currentSession.id,
        query: queryText,
      },
      {
        onSuccess: (data) => {
          // Set the queryId so ChatInterface can start streaming events
          setCurrentQueryId(data.id);
        },
        onError: (error) => {
          console.error('Failed to create query:', error);
          setProcessing(false);
          // Update agent message to show error
          const updateMessage = useSessionStore.getState().updateMessage;
          updateMessage(agentMessageId, {
            status: 'error',
            content: 'Failed to process query. Please try again.',
          });
        },
      }
    );

    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-4 py-4">
      <div className="flex gap-3 items-end">
        <div className="flex-1 relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about stocks, financials, or market analysis..."
            disabled={disabled}
            className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            rows={1}
            style={{
              minHeight: '52px',
              maxHeight: '200px',
            }}
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || disabled || isPending || !currentSession}
          className="px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-2xl transition-colors font-medium"
        >
          {isPending ? 'Sending...' : 'Send'}
        </button>
      </div>
      <div className="text-xs text-gray-500 mt-2 text-center">
        Press Enter to send, Shift+Enter for new line
      </div>
    </div>
  );
}
