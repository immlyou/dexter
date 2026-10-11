import { useEffect } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useUIStore } from '../../stores/uiStore';
import { useQueryStream } from '../../hooks/useQuery';
import MessageList from './MessageList';
import InputBox from './InputBox';
import Header from './Header';

export default function ChatInterface() {
  const messages = useSessionStore((state) => state.messages);
  const isProcessing = useSessionStore((state) => state.isProcessing);
  const currentQueryId = useSessionStore((state) => state.currentQueryId);
  const updateMessage = useSessionStore((state) => state.updateMessage);
  const setProcessing = useSessionStore((state) => state.setProcessing);
  const setCurrentQueryId = useSessionStore((state) => state.setCurrentQueryId);
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);

  // Stream events for the current query
  const { events, answer, error: streamError } = useQueryStream(currentQueryId || undefined, {
    onComplete: (finalAnswer) => {
      console.log('Query completed with answer:', finalAnswer);
      setProcessing(false);
      setCurrentQueryId(null);
    },
    onError: (err) => {
      console.error('Stream error:', err);
      setProcessing(false);
      setCurrentQueryId(null);
    },
  });

  // Update the latest agent message with streaming events
  useEffect(() => {
    if (events.length === 0) return;

    // Find the most recent agent message (should be the one being processed)
    const latestAgentMessage = [...messages]
      .reverse()
      .find((msg) => msg.type === 'agent');

    if (latestAgentMessage) {
      updateMessage(latestAgentMessage.id, {
        events: events,
        content: answer || '',
        status: answer ? 'complete' : 'processing',
      });
    }
  }, [events, answer, messages, updateMessage]);

  // Handle stream errors
  useEffect(() => {
    if (!streamError) return;

    const latestAgentMessage = [...messages]
      .reverse()
      .find((msg) => msg.type === 'agent');

    if (latestAgentMessage) {
      updateMessage(latestAgentMessage.id, {
        status: 'error',
        content: `Error: ${streamError}`,
      });
    }
  }, [streamError, messages, updateMessage]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <Header
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={toggleSidebar}
      />

      {/* Messages Area */}
      <div className="flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-4">🤖</div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">
                Welcome to Dexter
              </h2>
              <p className="text-gray-600">
                Your autonomous financial research assistant
              </p>
              <p className="text-sm text-gray-500 mt-4">
                Ask me anything about stocks, financial metrics, or market analysis
              </p>
            </div>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-200 bg-white">
        <InputBox disabled={isProcessing} />
      </div>
    </div>
  );
}
