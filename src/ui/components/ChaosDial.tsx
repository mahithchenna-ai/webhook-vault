import { useEffect, useState } from 'preact/hooks'
import type { ChaosConfig } from '../../core/config.js'

const PRESETS: Record<'calm' | 'flaky' | 'storm', ChaosConfig> = {
  calm: { preset: 'calm', duplicates: false, delayMs: 0, failRate: 0, outOfOrder: false },
  flaky: { preset: 'flaky', duplicates: true, delayMs: 400, failRate: 0.25, outOfOrder: false },
  storm: { preset: 'storm', duplicates: true, delayMs: 1200, failRate: 0.5, outOfOrder: true },
}

export function ChaosDial() {
  const [chaos, setChaos] = useState<ChaosConfig>(PRESETS.calm)
  const [savedNotice, setSavedNotice] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/_vault/api/chaos')
        if (!res.ok) return
        const data = (await res.json()) as { chaos?: ChaosConfig }
        if (data.chaos) setChaos(data.chaos)
      } catch {
        // Ignore initial fetch errors
      }
    })()
  }, [])

  const saveChaos = async (next: ChaosConfig) => {
    setChaos(next)
    setSavedNotice(false)
    try {
      const res = await fetch('/_vault/api/chaos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (res.ok) {
        setSavedNotice(true)
        setTimeout(() => setSavedNotice(false), 1800)
      }
    } catch {
      // Ignore save errors
    }
  }

  return (
    <section class="panel" aria-label="Chaos simulator dial">
      <div class="panel-header">
        <h2 class="panel-title">Chaos Dial</h2>
        {savedNotice && <span class="badge badge-ok">Saved</span>}
      </div>

      <div class="tabs" style={{ marginBottom: '0.75rem' }}>
        {(['calm', 'flaky', 'storm'] as const).map((preset) => (
          <button
            key={preset}
            type="button"
            aria-label={`Apply ${preset} chaos preset`}
            class={`btn btn-sm ${chaos.preset === preset ? 'btn-primary' : ''}`}
            onClick={() => void saveChaos({ ...PRESETS[preset] })}
          >
            {preset[0].toUpperCase() + preset.slice(1)}
          </button>
        ))}
      </div>

      <div class="slider-row">
        <label htmlFor="chaos-delay">Latency delay: {chaos.delayMs ?? 0}ms</label>
        <input
          id="chaos-delay"
          type="range"
          min="0"
          max="3000"
          step="50"
          aria-label="Chaos latency delay milliseconds"
          value={chaos.delayMs ?? 0}
          onChange={(e) =>
            void saveChaos({
              ...chaos,
              preset: undefined,
              delayMs: Number((e.target as HTMLInputElement).value),
            })
          }
        />
      </div>

      <div class="slider-row">
        <label htmlFor="chaos-fail-rate">
          Failure rate: {Math.round((chaos.failRate ?? 0) * 100)}%
        </label>
        <input
          id="chaos-fail-rate"
          type="range"
          min="0"
          max="1"
          step="0.05"
          aria-label="Chaos failure rate"
          value={chaos.failRate ?? 0}
          onChange={(e) =>
            void saveChaos({
              ...chaos,
              preset: undefined,
              failRate: Number((e.target as HTMLInputElement).value),
            })
          }
        />
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.84rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input
            type="checkbox"
            aria-label="Simulate duplicate deliveries"
            checked={Boolean(chaos.duplicates)}
            onChange={(e) =>
              void saveChaos({
                ...chaos,
                preset: undefined,
                duplicates: (e.target as HTMLInputElement).checked,
              })
            }
          />
          <span>Duplicates</span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <input
            type="checkbox"
            aria-label="Simulate out-of-order deliveries"
            checked={Boolean(chaos.outOfOrder)}
            onChange={(e) =>
              void saveChaos({
                ...chaos,
                preset: undefined,
                outOfOrder: (e.target as HTMLInputElement).checked,
              })
            }
          />
          <span>Out-of-order</span>
        </label>
      </div>
    </section>
  )
}
