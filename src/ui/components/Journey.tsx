import type { CapturedEvent } from '../../core/events.js'

interface JourneyProps {
  event: CapturedEvent
}

export function Journey({ event }: JourneyProps) {
  const latestReplay =
    event.replays.length > 0 ? event.replays[event.replays.length - 1] : null
  const finalStatus = latestReplay ? latestReplay.status : event.handler_status
  const finalLatency = latestReplay ? latestReplay.latency_ms : event.handler_latency_ms

  const captureErr = event.sig_status === 'invalid'
  const handlerErr = finalStatus !== null && finalStatus >= 400
  const responseOk = !captureErr && finalStatus !== null && finalStatus >= 200 && finalStatus < 300

  return (
    <section class="panel" aria-label="Webhook delivery journey">
      <div class="panel-header">
        <h2 class="panel-title">Webhook Journey</h2>
      </div>
      <div class="journey-track">
        <div class="journey-step ok">
          <div class="journey-step-title">Provider</div>
          <div class="journey-step-sub">{event.provider ?? 'generic'}</div>
        </div>
        <span class="journey-arrow" aria-hidden="true">
          →
        </span>
        <div class={`journey-step ${captureErr ? 'err' : 'ok'}`}>
          <div class="journey-step-title">Capture</div>
          <div class="journey-step-sub">
            sig: {event.sig_status}
            {event.sig_reason ? ` (${event.sig_reason})` : ''}
          </div>
        </div>
        <span class="journey-arrow" aria-hidden="true">
          →
        </span>
        <div class={`journey-step ${handlerErr ? 'err' : responseOk ? 'ok' : ''}`}>
          <div class="journey-step-title">Handler</div>
          <div class="journey-step-sub">
            {event.method} {event.path}
          </div>
        </div>
        <span class="journey-arrow" aria-hidden="true">
          →
        </span>
        <div class={`journey-step ${handlerErr ? 'err' : responseOk ? 'ok' : ''}`}>
          <div class="journey-step-title">Response</div>
          <div class="journey-step-sub">
            {finalStatus ?? 'pending'} {finalLatency !== null ? `(${finalLatency}ms)` : ''}
          </div>
        </div>
      </div>
    </section>
  )
}
