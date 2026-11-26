const useColor =
  process.stdout.isTTY !== false &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb'

function wrap(code: string, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text
}

export const color = {
  red: (s: string) => wrap('31', s),
  green: (s: string) => wrap('32', s),
  yellow: (s: string) => wrap('33', s),
  blue: (s: string) => wrap('34', s),
  cyan: (s: string) => wrap('36', s),
  dim: (s: string) => wrap('2', s),
  bold: (s: string) => wrap('1', s),
}

export class CliError extends Error {
  hint?: string
  constructor(message: string, hint?: string) {
    super(message)
    this.name = 'CliError'
    this.hint = hint
  }
}

export function printError(message: string, hint?: string): void {
  console.error(color.red(`✖ Error: ${message}`))
  if (hint) {
    console.error(color.yellow(`Hint: ${hint}`))
  }
}

export function printSuccess(message: string): void {
  console.log(color.green(`✔ ${message}`))
}

export function printWarn(message: string): void {
  console.log(color.yellow(`⚠ ${message}`))
}

export function printInfo(message: string): void {
  console.log(color.cyan(message))
}

export function formatSigStatus(status: string): string {
  if (status === 'valid') return color.green('valid')
  if (status === 'invalid') return color.red('invalid')
  return color.yellow('unsigned')
}

export function formatHttpStatus(status: number | null): string {
  if (status === null) return color.dim('-')
  if (status >= 200 && status < 300) return color.green(String(status))
  if (status >= 400) return color.red(String(status))
  return color.yellow(String(status))
}

export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => stripAnsi(r[i] ?? '').length))
  )
  const formatRow = (cols: string[]) =>
    cols
      .map((c, i) => {
        const pad = Math.max(0, widths[i] - stripAnsi(c).length)
        return c + ' '.repeat(pad)
      })
      .join('  ')

  console.log(color.bold(formatRow(headers)))
  console.log(color.dim(widths.map((w) => '─'.repeat(w)).join('  ')))
  for (const row of rows) {
    console.log(formatRow(row))
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}
