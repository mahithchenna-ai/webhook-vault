# webhook-vault

`webhook-vault` is a local-first webhook capture, signed-replay, and failure-simulation toolkit for Node.js developers, complete with a dev-only dashboard. Every captured payload stays in a local SQLite database on your machine—no cloud relays, no public tunnels, and no accounts required.

## 60-Second Quickstart

Install the package:

```bash
npm install --save-dev webhook-vault
```

Attach the Express middleware before your routes:

```ts
import express from 'express'
import { vault } from 'webhook-vault/express'

const app = express()

app.use(
  '/webhooks',
  vault({
    secrets: {
      stripe: process.env.STRIPE_WEBHOOK_SECRET,
      github: process.env.GITHUB_WEBHOOK_SECRET,
      razorpay: process.env.RAZORPAY_WEBHOOK_SECRET,
    },
  })
)

app.post('/webhooks/stripe', (req, res) => {
  // req.body is the raw Buffer; signature status has already been verified by vault()
  res.status(200).json({ received: true })
})

app.listen(3000)
```

Fire synthetic signed webhooks and open the dashboard:

```bash
npx webhook-vault demo --target http://localhost:3000
npx webhook-vault ui
```

Or use `webhook-vault/test` in Vitest / Jest without hitting the network:

```ts
import { createTestVault } from 'webhook-vault/test'

const tv = createTestVault({ secrets: { stripe: 'whsec_test' } })
const result = await tv.stripe('payment_intent.succeeded', {
  mode: { type: 'duplicate' },
  target: app,
})
```

## Important: Middleware Order Gotcha

> **Mount `vault()` BEFORE `express.json()` and BEFORE your webhook routes.**

Webhook signatures (Stripe, GitHub, Razorpay) are HMAC digests computed over the **exact raw request bytes**. If `app.use(express.json())` runs before `vault()`, Express consumes the stream and parses it into an object, changing whitespace or key order and breaking signature verification.

If you already mount `express.json()` globally, pass `captureRawBody` as the `verify` hook:

```ts
import express from 'express'
import { captureRawBody, vault } from 'webhook-vault/express'

const app = express()
app.use(express.json({ verify: captureRawBody }))
app.use('/webhooks', vault({ secrets: { stripe: process.env.STRIPE_WEBHOOK_SECRET } }))
```

Run `npx webhook-vault doctor` to detect pre-parsed bodies, wrong middleware order, missing secrets, or production safety issues automatically.

## CLI Command Reference

| Command | Description |
| --- | --- |
| `webhook-vault ui` | Start the local dev dashboard on port `4400` and open your browser |
| `webhook-vault demo --target <url>` | Seed and fire all 9 synthetic events (Stripe, GitHub, Razorpay) at a target URL |
| `webhook-vault list [--provider stripe\|github\|razorpay] [--status valid\|invalid\|unsigned] [--limit N]` | List captured events in SQLite |
| `webhook-vault show <id\|last>` | Print full redacted headers, payload body, signature details, and replay history |
| `webhook-vault replay <id\|last> [--resign] [--mode once\|duplicate\|fail-then-succeed] [--target <url>]` | Replay a captured event with optional fresh re-signing and failure modes |
| `webhook-vault chaos [--preset calm\|flaky\|storm] [--duplicates] [--delay-ms N] [--fail-rate 0-1] [--out-of-order]` | Configure local failure/latency chaos simulation in `.webhook-vault/chaos.json` |
| `webhook-vault doctor` | Inspect `.gitignore`, secrets, storage, and Express middleware diagnostics |
| `webhook-vault share <id\|last>` | Export redacted portable JSON (without `raw_body`) and a copy-paste `curl` command |

## How This Differs from Stripe CLI, ngrok, and Hookdeck

| Tool | Primary Job | Requires Cloud / Account | Works Offline / In CI |
| --- | --- | --- | --- |
| **Stripe CLI** | Forwards live Stripe sandbox events to localhost | Yes (Stripe account + CLI login) | No |
| **ngrok** | Exposes localhost over a public tunnel URL | Yes (account + tunnel) | No |
| **Hookdeck** | Hosted cloud webhook queue, routing, and retries | Yes (SaaS platform) | No |
| **webhook-vault** | Local SQLite capture, multi-provider signed replay, chaos modes, and CI test helper | **No** | **Yes** |

Use **Stripe CLI** or **ngrok** when you need live third-party provider servers to reach your laptop. Use **`webhook-vault`** when you want fast, offline, deterministic replay (including `duplicate`, `failThenSucceed`, `outOfOrder`, and Vitest assertions) without touching external networks.

## Storage & `.gitignore` Note

`webhook-vault` stores captured webhook data in `.webhook-vault/vault.db` (SQLite in WAL mode) and chaos settings in `.webhook-vault/chaos.json`. Although sensitive headers (`authorization`, `cookie`, `x-api-key`, `x-secret`, `x-webhook-secret`) are redacted to `[REDACTED]` before hitting disk, webhook payloads can still contain PII or test customer data.

Always add `.webhook-vault/` to your `.gitignore`:

```gitignore
.webhook-vault/
```

## Dashboard Preview

<!-- Screenshot / GIF placeholder -->
_Dashboard screenshot / walkthrough GIF coming soon (`http://127.0.0.1:4400/_vault/`): live SSE event stream, Journey pipeline visualization, parsed/raw payload inspector, side-by-side DiffView, Replay modes, and ChaosDial._

## Contributing

1. Clone the repository and install dependencies with `npm install`.
2. Build everything (TypeScript ESM+CJS+DTS and Vite/Preact UI) with `npm run build`.
3. Run tests, typechecks, and linting:

```bash
npm test
npm run typecheck
npm run lint
```

## License

MIT © [Mahith Chenna](LICENSE)
