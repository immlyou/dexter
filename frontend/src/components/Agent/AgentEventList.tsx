import type { AgentEvent } from '../../types';
import AgentEventItem from './AgentEventItem';

interface AgentEventListProps {
  events: AgentEvent[];
}

export default function AgentEventList({ events }: AgentEventListProps) {
  if (events.length === 0) return null;

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 space-y-2">
      {events.map((event, index) => (
        <AgentEventItem key={index} event={event} />
      ))}
    </div>
  );
}
