import { describe, test, expect } from 'bun:test';
import { AIMessage } from '@langchain/core/messages';
import { extractTextContent } from './ai-message.js';

const blocks = [
  { type: 'thinking', thinking: 'reasoning...', signature: 'sig' },
  { type: 'text', text: 'Apple revenue was $416B.' },
];

describe('extractTextContent', () => {
  test('returns string content as-is', () => {
    expect(extractTextContent(new AIMessage('hello'))).toBe('hello');
  });

  test('keeps only text blocks from a thinking + text AIMessage', () => {
    expect(extractTextContent(new AIMessage({ content: blocks }))).toBe('Apple revenue was $416B.');
  });

  test('accepts raw block-array content (what callLlm used to return)', () => {
    expect(extractTextContent(blocks)).toBe('Apple revenue was $416B.');
  });
});
