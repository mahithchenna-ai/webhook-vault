# Express Webhook Demo

A minimal Express server demonstrating `webhook-vault` signature verification, live dashboard capture, and non-idempotent vs. idempotent webhook handling.

## Setup

```bash
cd examples/express-demo
cp .env.example .env
npm install
npm run dev
```

## Try It Out

1. Seed and fire all 9 synthetic provider webhooks:

```bash
npx webhook-vault demo --target http://localhost:3000
```

2. Open the dashboard at `http://127.0.0.1:4400/_vault/`.
3. Observe non-idempotent duplicate charges by replaying the last Stripe event in duplicate mode:

```bash
npx webhook-vault replay last --mode duplicate --resign --target http://localhost:3000
curl http://localhost:3000/stats
```

4. Toggle idempotency ON and replay again:

```bash
curl -X POST http://localhost:3000/toggle-idempotency
npx webhook-vault replay last --mode duplicate --resign --target http://localhost:3000
curl http://localhost:3000/stats
```
