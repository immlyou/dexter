import { AIMessage } from '@langchain/core/messages';

/**
 * Extract text content from an AIMessage (or a raw message content value).
 * Models with extended thinking return content as a block array, e.g.
 * [{ type: 'thinking', ... }, { type: 'text', text: '...' }]; only text blocks are kept.
 */
export function extractTextContent(message: AIMessage | AIMessage['content']): string {
  const content = typeof message === 'string' || Array.isArray(message) ? message : message.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter(block => typeof block === 'object' && 'type' in block && block.type === 'text')
      .map(block => (block as { text: string }).text)
      .join('\n');
  }

  return '';
}

/**
 * Check if an AIMessage has tool calls
 */
export function hasToolCalls(message: AIMessage): boolean {
  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}
