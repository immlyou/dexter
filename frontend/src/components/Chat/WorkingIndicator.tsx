export default function WorkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-gray-600 text-sm py-2">
      <div className="flex gap-1">
        <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span>Thinking...</span>
    </div>
  );
}
