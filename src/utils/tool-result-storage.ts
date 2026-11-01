/**
 * Size capping for large tool results.
 *
 * CLI: the full result is saved under the data dir and a compact preview +
 * file path replaces it in the message array, so the model can read it back
 * via read_file. If the write fails (e.g. read-only working directory) the
 * result is truncated in memory instead.
 *
 * Web mode: nothing is written to disk and no server path is revealed (web
 * users have no read_file); the result is truncated in memory to a larger
 * bounded size.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { dexterDataPath } from './paths.js';
import { isWebMode } from './web-mode.js';

/** Maximum characters for a single tool result in context. */
export const MAX_TOOL_RESULT_CHARS = 50_000;

/** Characters to include in the preview when a result is persisted. */
export const PREVIEW_CHARS = 2_000;

/** Characters kept when a single oversized result is truncated in memory. */
export const IN_MEMORY_RESULT_CHARS = 40_000;

/**
 * Persist a large tool result to disk and return a compact preview,
 * or null if it could not be written.
 */
export function persistLargeResult(
  toolCallId: string,
  result: string,
): { preview: string; filePath: string } | null {
  const sanitizedId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const resultsDir = dexterDataPath('tool-results');
  const filePath = join(resultsDir, `${sanitizedId}.txt`);
  try {
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(filePath, result, 'utf-8');
  } catch {
    return null;
  }
  return { preview: result.slice(0, PREVIEW_CHARS), filePath };
}

/**
 * Build the replacement content for a persisted tool result.
 */
export function buildPersistedContent(
  filePath: string,
  preview: string,
  originalSizeBytes: number,
): string {
  const sizeKB = Math.round(originalSizeBytes / 1024);
  return `[Result persisted to ${filePath} (${sizeKB} KB)]\n\nPreview:\n${preview}\n\nUse read_file to access the full result if needed.`;
}

/**
 * Keep the first `maxChars` characters with a note that the rest was dropped.
 */
export function buildTruncatedContent(result: string, maxChars: number): string {
  if (result.length <= maxChars) return result;
  return `${result.slice(0, maxChars)}\n\n[Result truncated: showing the first ${maxChars} of ${result.length} characters. The rest is not available; narrow the request (e.g. fewer tickers or periods) to see more.]`;
}

/**
 * Replace an oversized result: persist + preview in the CLI, bounded in-memory
 * truncation in web mode or when persisting fails.
 */
export function capLargeResult(
  toolCallId: string,
  result: string,
  inMemoryChars: number = IN_MEMORY_RESULT_CHARS,
  webMode: boolean = isWebMode(),
): string {
  if (!webMode) {
    const persisted = persistLargeResult(toolCallId, result);
    if (persisted) {
      return buildPersistedContent(persisted.filePath, persisted.preview, result.length);
    }
  }
  return buildTruncatedContent(result, inMemoryChars);
}

/**
 * Check if a result exceeds the size cap.
 */
export function exceedsSizeCap(content: string): boolean {
  return content.length > MAX_TOOL_RESULT_CHARS;
}
