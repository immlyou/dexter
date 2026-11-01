/**
 * Shared utilities for financial tools.
 */
import { runWithAbortSignal } from './api.js';

/** Sub-tool timeout in milliseconds. Returns partial results on timeout.
 * Sized for cursor pagination: a year of daily prices arrives as ~25
 * sequential pages, which routinely exceeds the old 15s budget. */
export const SUB_TOOL_TIMEOUT_MS = 60_000;

/** Cache TTL constants. */
export const TTL_15M = 15 * 60 * 1000;
export const TTL_1H = 60 * 60 * 1000;
export const TTL_6H = 6 * 60 * 60 * 1000;
export const TTL_24H = 24 * 60 * 60 * 1000;

/**
 * Run `fn` against a timeout. Rejects with a descriptive error if it doesn't
 * settle within `ms` milliseconds; on timeout or when `parentSignal` aborts,
 * in-flight Financial Datasets requests made by `fn` are cancelled too.
 */
export function withTimeout<T>(
  fn: () => Promise<T>,
  ms: number,
  label?: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) onParentAbort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    runWithAbortSignal(controller.signal, fn),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label ?? 'Operation'} timed out after ${ms / 1000}s`);
        controller.abort(error);
        reject(error);
      }, ms);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  });
}
