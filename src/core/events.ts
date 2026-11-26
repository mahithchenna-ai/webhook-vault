export type Provider = 'stripe' | 'github' | 'razorpay'

export type SignResult = {
  header: string
  timestamp?: number
}

export type VerifyResult =
  | { valid: true }
  | {
      valid: false
      reason: 'wrong_secret' | 'timestamp_too_old' | 'body_modified' | 'malformed_header'
    }

export type SignatureStatus = 'valid' | 'invalid' | 'unsigned'

export interface ReplayRecord {
  attempt: number
  timestamp: number
  mode: string
  status: number
  headers: Record<string, string>
  body: string
  latency_ms: number
}

export interface CapturedEvent {
  id: string
  timestamp: number
  method: string
  path: string
  headers: Record<string, string>
  raw_body: string | null
  body_size: number
  provider: Provider | null
  event_type: string | null
  sig_status: SignatureStatus
  sig_reason: string | null
  handler_status: number | null
  handler_latency_ms: number | null
  replays: ReplayRecord[]
}

export type NewCapturedEvent = Omit<CapturedEvent, 'id' | 'replays'>

export interface EventFilter {
  provider?: string
  sigStatus?: string
  limit?: number
  offset?: number
}
