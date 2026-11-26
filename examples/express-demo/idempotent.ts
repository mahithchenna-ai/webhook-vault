export interface LedgerState {
  idempotentEnabled: boolean
  processedEvents: Set<string>
  chargesApplied: number
  duplicatesSkipped: number
}

export function createLedger(initialIdempotent = false): LedgerState {
  return {
    idempotentEnabled: initialIdempotent,
    processedEvents: new Set<string>(),
    chargesApplied: 0,
    duplicatesSkipped: 0,
  }
}

export function processChargeEvent(
  ledger: LedgerState,
  eventId: string
): { status: number; body: Record<string, unknown> } {
  if (ledger.idempotentEnabled && ledger.processedEvents.has(eventId)) {
    ledger.duplicatesSkipped += 1
    return {
      status: 200,
      body: {
        ok: true,
        deduplicated: true,
        eventId,
        chargesApplied: ledger.chargesApplied,
        duplicatesSkipped: ledger.duplicatesSkipped,
      },
    }
  }

  ledger.processedEvents.add(eventId)
  ledger.chargesApplied += 1

  return {
    status: 200,
    body: {
      ok: true,
      deduplicated: false,
      eventId,
      chargesApplied: ledger.chargesApplied,
      duplicatesSkipped: ledger.duplicatesSkipped,
    },
  }
}
