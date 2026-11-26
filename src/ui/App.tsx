import { useEffect, useState } from 'preact/hooks'
import type { CapturedEvent, ReplayRecord } from '../core/events.js'
import { ChaosDial } from './components/ChaosDial.js'
import { Confetti } from './components/Confetti.js'
import { DiffView } from './components/DiffView.js'
import { EventDetail } from './components/EventDetail.js'
import { EventList } from './components/EventList.js'
import { Journey } from './components/Journey.js'
import { ReplayPanel } from './components/ReplayPanel.js'
import { useCalmMode } from './hooks/useCalmMode.js'
import { useSSE } from './hooks/useSSE.js'

function playCue(ok: boolean): void {
  try {
    const AudioCtx = window.AudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = ok ? 660 : 280
    gain.gain.setValueAtTime(0.04, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.15)
  } catch {
    // Audio playback blocked or unavailable
  }
}

export function App() {
  const [calmMode, setCalmMode] = useCalmMode()
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [failingStreak, setFailingStreak] = useState(false)
  const [lastVerified200, setLastVerified200] = useState(false)

  const evaluateStatus = (ev: CapturedEvent, records?: ReplayRecord[]) => {
    const latest =
      records && records.length > 0
        ? records[records.length - 1].status
        : ev.replays.length > 0
          ? ev.replays[ev.replays.length - 1].status
          : ev.handler_status

    const isInvalidSig = ev.sig_status === 'invalid' && (!records || records.length === 0)
    const isFail = isInvalidSig || (latest !== null && latest >= 400)
    const isVerified200 = !isInvalidSig && latest === 200

    if (isFail) {
      setFailingStreak(true)
      setLastVerified200(false)
    } else if (isVerified200) {
      setFailingStreak(false)
      setLastVerified200(true)
    }
  }

  const { events, connected, recentIds, refresh, upsertEvent } = useSSE((incoming) => {
    evaluateStatus(incoming)
    if (soundEnabled && !calmMode) {
      const ok = incoming.sig_status !== 'invalid' && (incoming.handler_status ?? 500) < 400
      playCue(ok)
    }
  })

  useEffect(() => {
    if (!selectedId && events.length > 0) {
      setSelectedId(events[0].id)
    }
  }, [events, selectedId])

  const selectedEvent = events.find((e) => e.id === selectedId) ?? events[0] ?? null
  const compareEvent =
    compareId && compareId !== selectedEvent?.id
      ? events.find((e) => e.id === compareId) ?? null
      : null

  return (
    <div class="app-shell">
      <Confetti
        failingStreak={failingStreak}
        lastVerified200={lastVerified200}
        calmMode={calmMode}
      />

      <header class="topbar">
        <div class="brand">
          <h1>webhook-vault</h1>
          <span
            class={`badge ${connected ? 'badge-ok' : 'badge-warn'}`}
            aria-label={connected ? 'Live SSE stream connected' : 'SSE stream disconnected'}
          >
            {connected ? 'LIVE SSE' : 'OFFLINE'}
          </span>
        </div>

        <div class="topbar-controls">
          <button
            type="button"
            class="btn btn-sm"
            aria-label="Refresh events"
            onClick={() => void refresh()}
          >
            Refresh
          </button>

          <button
            type="button"
            class={`btn btn-sm ${soundEnabled ? 'btn-primary' : ''}`}
            aria-pressed={soundEnabled}
            aria-label="Toggle sound cues"
            onClick={() => setSoundEnabled((prev) => !prev)}
          >
            Sound: {soundEnabled ? 'On' : 'Off'}
          </button>

          <button
            type="button"
            class={`btn btn-sm ${calmMode ? 'btn-primary' : ''}`}
            aria-pressed={calmMode}
            aria-label="Toggle calm mode"
            onClick={() => setCalmMode(!calmMode)}
          >
            Calm Mode: {calmMode ? 'On' : 'Off'}
          </button>
        </div>
      </header>

      <main class="main-grid">
        <div class="stack">
          <EventList
            events={events}
            selectedId={selectedEvent?.id ?? null}
            compareId={compareId}
            recentIds={recentIds}
            calmMode={calmMode}
            onSelect={(id) => setSelectedId(id)}
            onSelectCompare={(id) => setCompareId((prev) => (prev === id ? null : id))}
          />
          <ChaosDial />
        </div>

        <div class="stack">
          {selectedEvent ? (
            <>
              <Journey event={selectedEvent} />
              <ReplayPanel
                event={selectedEvent}
                onReplayed={(updated, records) => {
                  upsertEvent(updated)
                  evaluateStatus(updated, records)
                }}
              />
              <EventDetail event={selectedEvent} />
              <DiffView eventA={selectedEvent} eventB={compareEvent} />
            </>
          ) : (
            <section class="panel" aria-label="Empty dashboard state">
              <h2 class="panel-title">Waiting for webhooks</h2>
              <p class="muted">
                Send a webhook to your Express endpoint or run{' '}
                <code>webhook-vault demo --target http://localhost:3000</code> to populate events.
              </p>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
