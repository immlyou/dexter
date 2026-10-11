import { useEffect, useRef } from 'react';
import type { Message } from '../../types';
import MessageItem from './MessageItem';

interface MessageListProps {
  messages: Message[];
}

export default function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
