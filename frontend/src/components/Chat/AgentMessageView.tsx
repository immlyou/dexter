import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentMessage } from '../../types';
import AgentEventList from '../Agent/AgentEventList';
import WorkingIndicator from './WorkingIndicator';

interface AgentMessageViewProps {
  message: AgentMessage;
}

export default function AgentMessageView({ message }: AgentMessageViewProps) {
  const isProcessing = message.status === 'processing';

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        {/* Agent Avatar and Label */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center">
            <span className="text-white text-sm">🤖</span>
          </div>
          <span className="text-sm font-medium text-gray-700">Dexter AI</span>
        </div>

        {/* Agent Events */}
        {message.events.length > 0 && (
          <div className="mb-3">
            <AgentEventList events={message.events} />
          </div>
        )}

        {/* Working Indicator */}
        {isProcessing && <WorkingIndicator />}

        {/* Answer */}
        {message.content && (
          <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
            <div className="text-xs text-gray-400 mt-2">
              {new Date(message.timestamp).toLocaleTimeString()}
            </div>
          </div>
        )}

        {/* Error State */}
        {message.status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            <div className="text-red-800 text-sm">
              An error occurred while processing your request.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
