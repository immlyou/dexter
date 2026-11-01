/**
 * Per-turn tool result budget enforcement.
 *
 * Caps the total tool result content per turn. When parallel tool calls
 * return large results that exceed the budget, the largest results are
 * capped first (persisted to disk in the CLI, truncated in memory in web mode).
 */

import { ToolMessage } from '@langchain/core/messages';
import { capLargeResult } from './tool-result-storage.js';

/** Maximum total characters across all tool results in a single turn. */
export const MAX_TURN_RESULT_CHARS = 200_000;

/** Characters kept per result when the budget forces in-memory truncation. */
export const BUDGET_IN_MEMORY_CHARS = 20_000;

/**
 * Enforce per-turn budget on tool results. Caps the largest results
 * until the total fits under the budget.
 *
 * Returns the original array if already under budget.
 */
export function enforceResultBudget(toolMessages: ToolMessage[]): ToolMessage[] {
  const indexed = toolMessages.map((tm, i) => ({
    index: i,
    tm,
    content: typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content),
  }));
  let remaining = indexed.reduce((sum, e) => sum + e.content.length, 0);

  if (remaining <= MAX_TURN_RESULT_CHARS) {
    return toolMessages;
  }

  // In-memory truncation keeps at most an equal share of the budget per result
  // (minus room for the truncation note), so the total always fits.
  const inMemoryChars = Math.max(
    0,
    Math.min(BUDGET_IN_MEMORY_CHARS, Math.floor(MAX_TURN_RESULT_CHARS / toolMessages.length) - 500),
  );

  // Cap largest first, accounting for the real size of each replacement
  const replacements = new Map<number, string>();
  for (const entry of [...indexed].sort((a, b) => b.content.length - a.content.length)) {
    if (remaining <= MAX_TURN_RESULT_CHARS) break;
    const replacement = capLargeResult(entry.tm.tool_call_id, entry.content, inMemoryChars);
    if (replacement.length >= entry.content.length) continue;
    replacements.set(entry.index, replacement);
    remaining += replacement.length - entry.content.length;
  }

  return toolMessages.map((tm, i) => {
    const replacement = replacements.get(i);
    if (replacement === undefined) return tm;
    return new ToolMessage({
      content: replacement,
      tool_call_id: tm.tool_call_id,
      name: tm.name,
    });
  });
}
