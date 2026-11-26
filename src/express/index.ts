import bodyParser from 'body-parser'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { DEFAULT_BODY_SIZE_LIMIT_BYTES, DEFAULT_VAULT_DIR, type VaultConfig } from '../core/config.js'
import type { CapturedEvent, NewCapturedEvent, SignatureStatus } from '../core/events.js'
import { VaultStorage } from '../core/storage.js'
import { verifyWebhook } from '../signing/index.js'
import {
  captureRawBody,
  detectProvider,
  extractEventType,
  getSignatureHeader,
  type RequestWithRawBody,
} from './capture.js'
import { normalizeHeaders, redactHeaders } from './redact.js'

export interface VaultMiddlewareOptions extends VaultConfig {
  storage?: VaultStorage
  onEvent?: (event: CapturedEvent) => void
}

export interface VaultMiddleware extends RequestHandler {
  storage: VaultStorage
  close: () => void
  __isWebhookVault: true
}

export function vault(options: VaultMiddlewareOptions = {}): VaultMiddleware {
  if (process.env.NODE_ENV === 'production' && !options.force) {
    throw new Error(
      'webhook-vault cannot run in production (NODE_ENV=production). Pass { force: true } to override.'
    )
  }

  const dir = options.dir ?? DEFAULT_VAULT_DIR
  const bodySizeLimitBytes = options.bodySizeLimitBytes ?? DEFAULT_BODY_SIZE_LIMIT_BYTES
  const extraRedactions = options.redactHeaders ?? []
  const secrets = options.secrets ?? {}
  const storage = options.storage ?? new VaultStorage(dir, { bodySizeLimitBytes })
  const onEvent = options.onEvent ?? (() => {})

  const rawBodyParser = bodyParser.raw({
    type: '*/*',
    limit: bodySizeLimitBytes,
    verify: captureRawBody,
  })

  const webhookVaultMiddleware: VaultMiddleware = function webhookVaultMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const startTime = performance.now()

    const handleCapturedRequest = (parseErr?: unknown): void => {
      const reqWithRaw = req as unknown as RequestWithRawBody
      let rawBuf: Buffer | null = null

      if (Buffer.isBuffer(reqWithRaw.__rawBody)) {
        rawBuf = reqWithRaw.__rawBody
      } else if (Buffer.isBuffer(reqWithRaw.body)) {
        rawBuf = reqWithRaw.body
      } else if (
        reqWithRaw._body &&
        reqWithRaw.body !== undefined &&
        !(parseErr instanceof Error)
      ) {
        rawBuf = Buffer.from(JSON.stringify(reqWithRaw.body), 'utf8')
      } else if (
        !req.headers['transfer-encoding'] &&
        Number(req.headers['content-length'] ?? 0) === 0
      ) {
        rawBuf = Buffer.alloc(0)
      }

      const normalized = normalizeHeaders(req.headers)
      const provider = detectProvider(normalized)
      const sigHeader = getSignatureHeader(provider, normalized)

      let sigStatus: SignatureStatus = 'unsigned'
      let sigReason: string | null = null

      if (provider && sigHeader !== undefined) {
        const secret = secrets[provider]
        if (secret) {
          const payloadBuf = rawBuf ?? Buffer.alloc(0)
          const verification = verifyWebhook(provider, payloadBuf, secret, sigHeader)
          if (verification.valid) {
            sigStatus = 'valid'
          } else {
            sigStatus = 'invalid'
            sigReason = verification.reason
          }
        }
      }

      const declaredSize = Number(req.headers['content-length'] ?? 0)
      const bodySize = rawBuf ? rawBuf.length : Number.isFinite(declaredSize) ? declaredSize : 0
      const rawBodyStr =
        rawBuf && bodySize <= bodySizeLimitBytes ? rawBuf.toString('utf8') : null
      const eventType = extractEventType(provider, normalized, rawBodyStr)
      const redacted = redactHeaders(normalized, extraRedactions)

      res.on('finish', () => {
        const latencyMs = Math.max(0, Math.round(performance.now() - startTime))
        const eventInput: NewCapturedEvent = {
          timestamp: Date.now(),
          method: req.method,
          path: req.originalUrl || req.url,
          headers: redacted,
          raw_body: rawBodyStr,
          body_size: bodySize,
          provider,
          event_type: eventType,
          sig_status: sigStatus,
          sig_reason: sigReason,
          handler_status: res.statusCode,
          handler_latency_ms: latencyMs,
        }

        const id = storage.insert(eventInput)
        const stored = storage.get(id)
        if (stored) {
          onEvent(stored)
        }
      })

      if (parseErr) {
        next(parseErr)
        return
      }
      next()
    }

    rawBodyParser(req, res, (err?: unknown) => {
      handleCapturedRequest(err)
    })
  } as VaultMiddleware

  webhookVaultMiddleware.storage = storage
  webhookVaultMiddleware.close = () => {
    storage.close()
  }
  webhookVaultMiddleware.__isWebhookVault = true

  return webhookVaultMiddleware
}

export { captureRawBody, detectProvider, extractEventType } from './capture.js'
export { redactHeaders, normalizeHeaders } from './redact.js'
export type { RedactedHeaders } from './redact.js'
export { runDoctor } from './doctor.js'
export type { DiagnosticResult, DiagnosticSeverity, DoctorOptions } from './doctor.js'
