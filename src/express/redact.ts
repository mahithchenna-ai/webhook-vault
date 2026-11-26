const BUILT_IN = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'x-secret',
  'x-webhook-secret',
])

export type RedactedHeaders = Record<string, string>

export function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const lowerKey = key.toLowerCase()
    result[lowerKey] = Array.isArray(value) ? value.join(', ') : value
  }
  return result
}

export function redactHeaders(
  headers: Record<string, string | string[] | undefined>,
  extra: string[] = []
): RedactedHeaders {
  const extraSet = new Set(extra.map((h) => h.toLowerCase()))
  const normalized = normalizeHeaders(headers)
  return Object.fromEntries(
    Object.entries(normalized).map(([k, v]) => {
      const lk = k.toLowerCase()
      return [lk, BUILT_IN.has(lk) || extraSet.has(lk) ? '[REDACTED]' : v]
    })
  )
}
