export const DEFAULT_VAULT_DIR = '.webhook-vault'
export const DEFAULT_BODY_SIZE_LIMIT_BYTES = 1_048_576
export const DEFAULT_DASHBOARD_PORT = 4400

export interface SecretsConfig {
  stripe?: string
  github?: string
  razorpay?: string
}

export interface VaultConfig {
  secrets?: SecretsConfig
  dir?: string
  bodySizeLimitBytes?: number
  redactHeaders?: string[]
  force?: boolean
  dashboardPort?: number
  enableDashboard?: boolean
}

export interface ChaosConfig {
  preset?: 'calm' | 'flaky' | 'storm'
  duplicates?: boolean
  delayMs?: number
  failRate?: number
  outOfOrder?: boolean
}
