import { useState } from 'preact/hooks'
import type { CapturedEvent } from '../../core/events.js'

interface EventDetailProps {
  event: CapturedEvent
}

function getSigHint(reason: string | null): string | null {
  switch (reason) {
    case 'wrong_secret':
      return 'Check that your signing secret matches the provider dashboard or CLI test secret.'
    case 'timestamp_too_old':
      return 'The timestamp header fell outside the 300s tolerance. Use Re-sign when replaying.'
    case 'body_modified':
      return 'Raw request bytes differed from the signed digest. Ensure express.json() does not run before vault().'
    case 'malformed_header':
      return 'Signature header format was unrecognized for this provider.'
    default:
      return null
  }
}

export function EventDetail({ event }: EventDetailProps) {
  const [viewMode, setViewMode] = useState<'parsed' | 'raw'>('parsed')

  const formattedJson = (() => {
    if (event.raw_body === null) return '[Body omitted: exceeded bodySizeLimitBytes]'
    try {
      return JSON.stringify(JSON.parse(event.raw_body), null, 2)
    } catch {
      return event.raw_body
    }
  })()

  const rawDisplay =
    event.raw_body === null ? '[Body omitted: exceeded bodySizeLimitBytes]' : event.raw_body

  const sigHint = getSigHint(event.sig_reason)

  return (
    <section class="panel" aria-label="Selected event details">
      <div class="panel-header">
        <div>
          <h2 class="panel-title">
            {event.method} {event.path}
          </h2>
          <span class="muted">
            ID: <code>{event.id}</code> · {new Date(event.timestamp).toLocaleString()} ·{' '}
            {event.body_size} bytes
          </span>
        </div>
        <div class="tabs" role="tablist" aria-label="Payload view mode">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'parsed'}
            class={`btn btn-sm ${viewMode === 'parsed' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('parsed')}
          >
            Parsed JSON
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'raw'}
            class={`btn btn-sm ${viewMode === 'raw' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode('raw')}
          >
            Raw Bytes
          </button>
        </div>
      </div>

      <div class="stack">
        <div class="panel" aria-label="Signature verification panel">
          <div class="panel-header">
            <h3 class="panel-title">Signature Verification</h3>
            <span
              class={`badge ${
                event.sig_status === 'valid'
                  ? 'badge-ok'
                  : event.sig_status === 'invalid'
                    ? 'badge-err'
                    : 'badge-warn'
              }`}
            >
              {event.sig_status}
            </span>
          </div>
          <p class="muted" style={{ margin: 0 }}>
            Provider: <strong>{event.provider ?? 'unknown'}</strong>
            {event.sig_reason ? ` · Reason: ${event.sig_reason}` : ''}
          </p>
          {sigHint && (
            <p class="muted" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
              Hint: {sigHint}
            </p>
          )}
        </div>

        <div>
          <h3 class="panel-title" style={{ marginBottom: '0.4rem' }}>
            Body ({viewMode === 'parsed' ? 'Parsed JSON' : 'Raw Bytes'})
          </h3>
          <pre class="code-block" aria-label="Event payload body">
            {viewMode === 'parsed' ? formattedJson : rawDisplay}
          </pre>
        </div>

        <div>
          <h3 class="panel-title" style={{ marginBottom: '0.4rem' }}>
            Headers (Redacted)
          </h3>
          <table class="kv-table" aria-label="Event headers">
            <tbody>
              {Object.entries(event.headers).map(([key, val]) => (
                <tr key={key}>
                  <th scope="row">{key}</th>
                  <td>
                    {val === '[REDACTED]' ? <span class="badge badge-warn">[REDACTED]</span> : val}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
