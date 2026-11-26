import { useEffect, useState } from 'preact/hooks'
import type { CapturedEvent, ReplayRecord } from '../../core/events.js'

interface ReplayPanelProps {
  event: CapturedEvent
  onReplayed: (updated: CapturedEvent, records: ReplayRecord[]) => void
}

function defaultTargetForEvent(event: CapturedEvent): string {
  const host = event.headers.host
  if (host && host !== '[REDACTED]') {
    return `http://${host}${event.path}`
  }
  return `http://localhost:3000${event.path}`
}

export function ReplayPanel({ event, onReplayed }: ReplayPanelProps) {
  const [target, setTarget] = useState(() => defaultTargetForEvent(event))
  const [resign, setResign] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveAttempts, setLiveAttempts] = useState<ReplayRecord[]>([])

  useEffect(() => {
    setTarget(defaultTargetForEvent(event))
    setLiveAttempts([])
    setError(null)
  }, [event.id])

  const triggerReplay = async (mode: 'once' | 'duplicate' | 'fail-then-succeed') => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/_vault/api/events/${encodeURIComponent(event.id)}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, resign, target }),
      })
      const data = (await res.json()) as {
        error?: string
        result?: { attempts: ReplayRecord[] }
        event?: CapturedEvent
      }
      if (!res.ok || data.error) {
        setError(data.error ?? `Replay failed (${res.status})`)
        return
      }
      const attempts = data.result?.attempts ?? []
      setLiveAttempts(attempts)
      if (data.event) {
        onReplayed(data.event, attempts)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section class="panel" aria-label="Replay webhook panel">
      <div class="panel-header">
        <h2 class="panel-title">Replay Engine</h2>
      </div>

      <div class="stack">
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.84rem' }}>
          <span>Target URL</span>
          <input
            class="input"
            type="url"
            aria-label="Replay target URL"
            value={target}
            onInput={(e) => setTarget((e.target as HTMLInputElement).value)}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.84rem' }}>
          <input
            type="checkbox"
            aria-label="Re-sign payload before replay"
            checked={resign}
            onChange={(e) => setResign((e.target as HTMLInputElement).checked)}
          />
          <span>Re-sign payload with current timestamp</span>
        </label>

        <div class="tabs">
          <button
            type="button"
            class="btn btn-primary"
            disabled={loading}
            aria-label="Replay once"
            onClick={() => void triggerReplay('once')}
          >
            Once
          </button>
          <button
            type="button"
            class="btn"
            disabled={loading}
            aria-label="Replay duplicate"
            onClick={() => void triggerReplay('duplicate')}
          >
            Duplicate (2x)
          </button>
          <button
            type="button"
            class="btn"
            disabled={loading}
            aria-label="Replay fail then succeed"
            onClick={() => void triggerReplay('fail-then-succeed')}
          >
            Fail-then-succeed
          </button>
        </div>

        {error && (
          <p class="badge badge-err" role="alert">
            {error}
          </p>
        )}

        {liveAttempts.length > 0 && (
          <div>
            <h3 class="panel-title" style={{ marginBottom: '0.35rem' }}>
              Latest Replay Response
            </h3>
            {liveAttempts.map((a) => (
              <div key={`${a.attempt}-${a.timestamp}`} style={{ marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <span class={`badge ${a.status >= 200 && a.status < 300 ? 'badge-ok' : 'badge-err'}`}>
                    Attempt #{a.attempt}: {a.status}
                  </span>
                  <span class="muted">{a.latency_ms}ms · {a.mode}</span>
                </div>
                <pre class="code-block">{a.body || '(empty response body)'}</pre>
              </div>
            ))}
          </div>
        )}

        {event.replays.length > 0 && (
          <div>
            <h3 class="panel-title" style={{ marginBottom: '0.35rem' }}>
              History ({event.replays.length})
            </h3>
            <table class="kv-table" aria-label="Replay attempt history">
              <tbody>
                {event.replays.map((r, idx) => (
                  <tr key={idx}>
                    <th scope="row">
                      #{r.attempt} ({r.mode})
                    </th>
                    <td>
                      <span class={`badge ${r.status >= 200 && r.status < 300 ? 'badge-ok' : 'badge-err'}`}>
                        {r.status}
                      </span>{' '}
                      <span class="muted">{r.latency_ms}ms</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
