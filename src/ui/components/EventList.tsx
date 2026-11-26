import { useState } from 'preact/hooks'
import type { CapturedEvent } from '../../core/events.js'

interface EventListProps {
  events: CapturedEvent[]
  selectedId: string | null
  compareId: string | null
  recentIds: Set<string>
  calmMode: boolean
  onSelect: (id: string) => void
  onSelectCompare: (id: string) => void
}

function isFailingEvent(ev: CapturedEvent): boolean {
  if (ev.sig_status === 'invalid') return true
  if (ev.handler_status !== null && ev.handler_status >= 400) return true
  return false
}

export function EventList({
  events,
  selectedId,
  compareId,
  recentIds,
  calmMode,
  onSelect,
  onSelectCompare,
}: EventListProps) {
  const [providerFilter, setProviderFilter] = useState('')
  const [sigFilter, setSigFilter] = useState('')
  const [search, setSearch] = useState('')

  const filtered = events.filter((ev) => {
    if (providerFilter && ev.provider !== providerFilter) return false
    if (sigFilter && ev.sig_status !== sigFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const matchesId = ev.id.toLowerCase().includes(q)
      const matchesType = (ev.event_type ?? '').toLowerCase().includes(q)
      const matchesPath = ev.path.toLowerCase().includes(q)
      if (!matchesId && !matchesType && !matchesPath) return false
    }
    return true
  })

  return (
    <section class="panel" aria-label="Captured webhook events">
      <div class="panel-header">
        <h2 class="panel-title">Events ({filtered.length})</h2>
      </div>

      <div class="filter-bar">
        <input
          class="input"
          type="search"
          aria-label="Filter events by ID, type, or path"
          placeholder="Search id, event type, or path..."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
        <select
          class="select"
          aria-label="Filter by provider"
          value={providerFilter}
          onChange={(e) => setProviderFilter((e.target as HTMLSelectElement).value)}
        >
          <option value="">All providers</option>
          <option value="stripe">Stripe</option>
          <option value="github">GitHub</option>
          <option value="razorpay">Razorpay</option>
        </select>
        <select
          class="select"
          aria-label="Filter by signature status"
          value={sigFilter}
          onChange={(e) => setSigFilter((e.target as HTMLSelectElement).value)}
        >
          <option value="">All signatures</option>
          <option value="valid">Valid</option>
          <option value="invalid">Invalid</option>
          <option value="unsigned">Unsigned</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <p class="muted">No events match current filters.</p>
      ) : (
        <div class="event-items" role="listbox" aria-label="Webhook event list">
          {filtered.map((ev) => {
            const isRecent = recentIds.has(ev.id)
            const failing = isFailingEvent(ev)
            const pulseClass = !calmMode && isRecent ? (failing ? 'pulse-err' : 'pulse-ok') : ''
            const selectedClass = ev.id === selectedId ? 'selected' : ''

            return (
              <div
                key={ev.id}
                role="option"
                tabIndex={0}
                aria-selected={ev.id === selectedId}
                aria-label={`${ev.provider ?? 'unknown'} ${ev.event_type ?? ev.path} status ${ev.handler_status ?? 'pending'}`}
                class={`event-row ${selectedClass} ${pulseClass}`.trim()}
                onClick={() => onSelect(ev.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(ev.id)
                  }
                }}
              >
                <div class="event-row-top">
                  <strong>{ev.event_type ?? ev.path}</strong>
                  <span
                    class={`badge ${
                      ev.handler_status && ev.handler_status >= 200 && ev.handler_status < 300
                        ? 'badge-ok'
                        : ev.handler_status && ev.handler_status >= 400
                          ? 'badge-err'
                          : 'badge-neutral'
                    }`}
                  >
                    {ev.handler_status ?? '-'}
                  </span>
                </div>
                <div class="event-row-meta">
                  <span>
                    {ev.provider ?? 'generic'} ·{' '}
                    <span
                      class={`badge ${
                        ev.sig_status === 'valid'
                          ? 'badge-ok'
                          : ev.sig_status === 'invalid'
                            ? 'badge-err'
                            : 'badge-warn'
                      }`}
                    >
                      {ev.sig_status}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="btn btn-sm"
                    aria-label={`Compare event ${ev.id}`}
                    aria-pressed={compareId === ev.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectCompare(ev.id)
                    }}
                  >
                    {compareId === ev.id ? 'Comparing' : 'Diff'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
