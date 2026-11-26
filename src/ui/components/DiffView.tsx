import type { CapturedEvent } from '../../core/events.js'

interface DiffViewProps {
  eventA: CapturedEvent
  eventB: CapturedEvent | null
}

interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
}

function diffLines(leftText: string, rightText: string): { left: DiffLine[]; right: DiffLine[] } {
  const a = leftText.split('\n')
  const b = rightText.split('\n')
  const n = a.length
  const m = b.length

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1]
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const left: DiffLine[] = []
  const right: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      left.push({ kind: 'same', text: a[i] })
      right.push({ kind: 'same', text: b[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ kind: 'del', text: a[i] })
      right.push({ kind: 'same', text: '' })
      i++
    } else {
      left.push({ kind: 'same', text: '' })
      right.push({ kind: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) {
    left.push({ kind: 'del', text: a[i++] })
    right.push({ kind: 'same', text: '' })
  }
  while (j < m) {
    left.push({ kind: 'same', text: '' })
    right.push({ kind: 'add', text: b[j++] })
  }

  return { left, right }
}

function formatEventSection(ev: CapturedEvent): { headers: string; body: string } {
  const sortedHeaders = Object.fromEntries(
    Object.entries(ev.headers).sort(([ka], [kb]) => ka.localeCompare(kb))
  )
  const headers = JSON.stringify(sortedHeaders, null, 2)
  let body = ev.raw_body ?? '[omitted]'
  if (ev.raw_body) {
    try {
      body = JSON.stringify(JSON.parse(ev.raw_body), null, 2)
    } catch {
      body = ev.raw_body
    }
  }
  return { headers, body }
}

export function DiffView({ eventA, eventB }: DiffViewProps) {
  if (!eventB) {
    return (
      <section class="panel" aria-label="Event diff comparison">
        <div class="panel-header">
          <h2 class="panel-title">Diff View</h2>
        </div>
        <p class="muted" style={{ margin: 0 }}>
          Click <strong>Diff</strong> on another event in the list to compare headers and payloads
          side-by-side with <code>{eventA.id}</code>.
        </p>
      </section>
    )
  }

  const leftFmt = formatEventSection(eventA)
  const rightFmt = formatEventSection(eventB)
  const headersDiff = diffLines(leftFmt.headers, rightFmt.headers)
  const bodyDiff = diffLines(leftFmt.body, rightFmt.body)

  return (
    <section class="panel" aria-label="Event diff comparison">
      <div class="panel-header">
        <h2 class="panel-title">
          Diff: <code>{eventA.id}</code> vs <code>{eventB.id}</code>
        </h2>
      </div>

      <h3 class="panel-title" style={{ marginBottom: '0.35rem' }}>
        Headers
      </h3>
      <div class="diff-grid" style={{ marginBottom: '0.85rem' }}>
        <div class="diff-col" aria-label="Left event headers">
          {headersDiff.left.map((line, idx) => (
            <div key={idx} class={`diff-line ${line.kind === 'del' ? 'diff-del' : ''}`}>
              {line.text || ' '}
            </div>
          ))}
        </div>
        <div class="diff-col" aria-label="Right event headers">
          {headersDiff.right.map((line, idx) => (
            <div key={idx} class={`diff-line ${line.kind === 'add' ? 'diff-add' : ''}`}>
              {line.text || ' '}
            </div>
          ))}
        </div>
      </div>

      <h3 class="panel-title" style={{ marginBottom: '0.35rem' }}>
        Payload Body
      </h3>
      <div class="diff-grid">
        <div class="diff-col" aria-label="Left event body">
          {bodyDiff.left.map((line, idx) => (
            <div key={idx} class={`diff-line ${line.kind === 'del' ? 'diff-del' : ''}`}>
              {line.text || ' '}
            </div>
          ))}
        </div>
        <div class="diff-col" aria-label="Right event body">
          {bodyDiff.right.map((line, idx) => (
            <div key={idx} class={`diff-line ${line.kind === 'add' ? 'diff-add' : ''}`}>
              {line.text || ' '}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
