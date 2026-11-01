import type { UserMessage } from '../../types';

interface UserMessageViewProps {
  message: UserMessage;
}

export default function UserMessageView({ message }: UserMessageViewProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-primary-600 text-white rounded-2xl px-4 py-3">
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        <div className="text-xs text-primary-100 mt-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}
