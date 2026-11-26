import 'dotenv/config'
import express from 'express'
import { verifyGithub, verifyRazorpay, verifyStripe } from 'webhook-vault'
import { vault } from 'webhook-vault/express'
import { createLedger, processChargeEvent } from './idempotent.js'

const app = express()
const port = Number(process.env.PORT ?? 3000)

const secrets = {
  stripe: process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_demo',
  github: process.env.GITHUB_WEBHOOK_SECRET ?? 'ghsec_demo',
  razorpay: process.env.RAZORPAY_WEBHOOK_SECRET ?? 'rzsec_demo',
}

const ledger = createLedger(process.env.IDEMPOTENT === 'true')

// IMPORTANT: Mount vault() BEFORE express.json() or route handlers so raw bytes are captured intact.
app.use(
  '/webhooks',
  vault({
    secrets,
    dir: '.webhook-vault',
    dashboardPort: 4400,
  })
)

app.post('/webhooks/stripe', (req, res) => {
  const raw = req.body as Buffer
  const sig = String(req.headers['stripe-signature'] ?? '')
  const check = verifyStripe(raw, secrets.stripe, sig)
  if (!check.valid) {
    res.status(400).json({ error: check.reason })
    return
  }
  const payload = JSON.parse(raw.toString('utf8')) as { id?: string }
  const eventId = payload.id ?? 'unknown'
  const outcome = processChargeEvent(ledger, eventId)
  res.status(outcome.status).json(outcome.body)
})

app.post('/webhooks/github', (req, res) => {
  const raw = req.body as Buffer
  const sig = String(req.headers['x-hub-signature-256'] ?? '')
  const check = verifyGithub(raw, secrets.github, sig)
  if (!check.valid) {
    res.status(400).json({ error: check.reason })
    return
  }
  res.status(200).json({ ok: true, event: req.headers['x-github-event'] ?? 'unknown' })
})

app.post('/webhooks/razorpay', (req, res) => {
  const raw = req.body as Buffer
  const sig = String(req.headers['x-razorpay-signature'] ?? '')
  const check = verifyRazorpay(raw, secrets.razorpay, sig)
  if (!check.valid) {
    res.status(400).json({ error: check.reason })
    return
  }
  res.status(200).json({ ok: true })
})

app.post('/toggle-idempotency', (_req, res) => {
  ledger.idempotentEnabled = !ledger.idempotentEnabled
  res.json({
    idempotentEnabled: ledger.idempotentEnabled,
    chargesApplied: ledger.chargesApplied,
    duplicatesSkipped: ledger.duplicatesSkipped,
  })
})

app.get('/stats', (_req, res) => {
  res.json({
    idempotentEnabled: ledger.idempotentEnabled,
    chargesApplied: ledger.chargesApplied,
    duplicatesSkipped: ledger.duplicatesSkipped,
  })
})

app.listen(port, () => {
  console.log(`Express webhook demo listening on http://localhost:${port}`)
  console.log(`webhook-vault dashboard available at http://127.0.0.1:4400/_vault/`)
  console.log(`Idempotency mode: ${ledger.idempotentEnabled ? 'ENABLED' : 'DISABLED (non-idempotent)'}`)
})
