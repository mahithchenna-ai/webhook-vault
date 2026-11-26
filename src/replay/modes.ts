export type ReplayMode =
  | { type: 'once' }
  | { type: 'duplicate' }
  | { type: 'outOfOrder'; sequence: string[] }
  | { type: 'failThenSucceed'; maxAttempts?: number; backoffMs?: number }

export const MAX_BACKOFF_MS = 30_000
export const DEFAULT_BACKOFF_MS = 1_000
export const DEFAULT_MAX_ATTEMPTS = 5

export function calculateBackoffMs(
  attemptIndex: number,
  backoffMs: number = DEFAULT_BACKOFF_MS
): number {
  const safeAttempt = Math.max(0, attemptIndex)
  const safeBase = Math.max(0, backoffMs)
  return Math.min(safeBase * 2 ** safeAttempt, MAX_BACKOFF_MS)
}

export function resolveOutOfOrderSequence(eventIds: string[], sequence?: string[]): string[] {
  if (sequence && sequence.length > 0) {
    return [...sequence]
  }
  return [...eventIds].reverse()
}

export function parseReplayMode(modeStr?: string, sequence: string[] = []): ReplayMode {
  switch (modeStr) {
    case undefined:
    case '':
    case 'once':
      return { type: 'once' }
    case 'duplicate':
      return { type: 'duplicate' }
    case 'fail-then-succeed':
    case 'failThenSucceed':
      return { type: 'failThenSucceed' }
    case 'out-of-order':
    case 'outOfOrder':
      return { type: 'outOfOrder', sequence }
    default:
      throw new Error(
        `Unknown replay mode "${modeStr}". Expected once, duplicate, fail-then-succeed, or out-of-order.`
      )
  }
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}
