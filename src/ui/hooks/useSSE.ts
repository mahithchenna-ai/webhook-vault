import { useEffect, useRef, useState } from 'preact/hooks'
import type { CapturedEvent } from '../../core/events.js'

export interface UseSSEResult {
  events: CapturedEvent[]
  connected: boolean
  recentIds: Set<string>
  refresh: () => Promise<void>
  upsertEvent: (event: CapturedEvent) => void
}

export function useSSE(onNewEvent?: (event: CapturedEvent) => void): UseSSEResult {
  const [events, setEvents] = useState<CapturedEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set())
  const onNewRef = useRef(onNewEvent)
  onNewRef.current = onNewEvent

  const upsertEvent = (incoming: CapturedEvent) => {
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.id === incoming.id)
      if (idx === -1) {
        return [incoming, ...prev]
      }
      const next = [...prev]
      next[idx] = incoming
      return next
    })
    setRecentIds((prev) => new Set(prev).add(incoming.id))
    setTimeout(() => {
      setRecentIds((prev) => {
        const next = new Set(prev)
        next.delete(incoming.id)
        return next
      })
    }, 2400)
  }

  const refresh = async () => {
    const res = await fetch('/_vault/api/events')
    if (!res.ok) return
    const data = (await res.json()) as { events?: CapturedEvent[] }
    if (Array.isArray(data.events)) {
      setEvents(data.events)
    }
  }

  useEffect(() => {
    void refresh()

    const evtSource = new EventSource('/_vault/events')
    evtSource.onopen = () => setConnected(true)
    evtSource.onerror = () => setConnected(false)
    evtSource.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as CapturedEvent
        upsertEvent(parsed)
        onNewRef.current?.(parsed)
      } catch {
        // Ignore malformed frames or heartbeats
      }
    }

    return () => {
      evtSource.close()
      setConnected(false)
    }
  }, [])

  return { events, connected, recentIds, refresh, upsertEvent }
}
