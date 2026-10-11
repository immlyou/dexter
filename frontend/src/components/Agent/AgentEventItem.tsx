import type { AgentEvent } from '../../types';

interface AgentEventItemProps {
  event: AgentEvent;
}

// Format tool name from snake_case to Title Case
function formatToolName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Format tool arguments
function formatArgs(args: Record<string, unknown>): string {
  if (Object.keys(args).length === 1 && 'query' in args) {
    const query = String(args.query);
    return `"${query.length > 60 ? query.slice(0, 60) + '...' : query}"`;
  }

  return Object.entries(args)
    .map(([key, value]) => {
      const strValue = String(value);
      return `${key}=${strValue.length > 40 ? strValue.slice(0, 40) + '...' : strValue}`;
    })
    .join(', ');
}

// Format duration
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function AgentEventItem({ event }: AgentEventItemProps) {
  switch (event.type) {
    case 'thinking':
      return (
        <div className="text-sm text-gray-700">
          <span className="text-gray-500">{event.message}</span>
        </div>
      );

    case 'tool_start':
      return (
        <div className="flex items-start gap-2 text-sm">
          <span className="text-gray-500">⏺</span>
          <div className="flex-1">
            <span className="font-medium text-gray-800">
              {formatToolName(event.tool)}
            </span>
            <span className="text-gray-500 ml-1">
              ({formatArgs(event.args)})
            </span>
          </div>
        </div>
      );

    case 'tool_end':
      return (
        <div className="flex items-start gap-2 text-sm">
          <span className="text-gray-500">⏺</span>
          <div className="flex-1">
            <span className="font-medium text-gray-800">
              {formatToolName(event.tool)}
            </span>
            <span className="text-gray-500 ml-1">
              ({formatArgs(event.args)})
            </span>
            <div className="ml-4 text-gray-600 text-xs mt-1">
              ⎿ Completed in {formatDuration(event.duration)}
            </div>
          </div>
        </div>
      );

    case 'tool_progress':
      return (
        <div className="flex items-start gap-2 text-sm">
          <span className="text-gray-500">⏺</span>
          <div className="flex-1">
            <span className="font-medium text-gray-800">
              {formatToolName(event.tool)}
            </span>
            <div className="ml-4 text-gray-600 text-xs mt-1">
              ⎿ {event.message}
            </div>
          </div>
        </div>
      );

    case 'tool_error':
      return (
        <div className="flex items-start gap-2 text-sm">
          <span className="text-red-500">⏺</span>
          <div className="flex-1">
            <span className="font-medium text-red-800">
              {formatToolName(event.tool)}
            </span>
            <div className="ml-4 text-red-600 text-xs mt-1">
              ⎿ Error: {event.error}
            </div>
          </div>
        </div>
      );

    case 'tool_limit':
      return (
        <div className="flex items-start gap-2 text-sm">
          <span className="text-yellow-500">⏺</span>
          <div className="flex-1">
            <span className="font-medium text-yellow-800">
              {formatToolName(event.tool)}
            </span>
            <div className="ml-4 text-yellow-600 text-xs mt-1">
              ⎿ {event.warning || 'Approaching limit'}
            </div>
          </div>
        </div>
      );

    case 'context_cleared':
      return (
        <div className="text-sm text-gray-600">
          <span className="text-gray-500">⏺</span>
          <span className="ml-2">
            Context cleared - removed {event.clearedCount} old results, kept{' '}
            {event.keptCount} recent
          </span>
        </div>
      );

    case 'answer_start':
      return (
        <div className="text-sm text-gray-600">
          <span className="text-gray-500">✓</span>
          <span className="ml-2">Generating answer...</span>
        </div>
      );

    case 'done':
      return (
        <div className="text-sm text-green-600">
          <span>✓</span>
          <span className="ml-2">
            Completed in {formatDuration(event.totalTime)} with {event.toolCalls}{' '}
            tool calls
          </span>
        </div>
      );

    default:
      return null;
  }
}
