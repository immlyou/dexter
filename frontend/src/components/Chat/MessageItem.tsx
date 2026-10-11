import type { Message } from '../../types';
import UserMessageView from './UserMessageView';
import AgentMessageView from './AgentMessageView';

interface MessageItemProps {
  message: Message;
}

export default function MessageItem({ message }: MessageItemProps) {
  if (message.type === 'user') {
    return <UserMessageView message={message} />;
  }

  return <AgentMessageView message={message} />;
}
