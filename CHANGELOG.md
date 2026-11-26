# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2024-01-01

### Added
- Constant-time webhook signing and verification for Stripe, GitHub, and Razorpay
- Local SQLite (`better-sqlite3`) event capture and replay history storage with size capping
- Express middleware (`webhook-vault/express`) with raw-body capture, header redaction, production guard, and `runDoctor` diagnostics
- Replay engine with `once`, `duplicate`, `outOfOrder`, and exponential-backoff `failThenSucceed` delivery modes
- Synthetic payload simulator covering 9 Stripe, GitHub, and Razorpay event types
- Zero-network Vitest/Express test helper (`webhook-vault/test`) using `supertest` and `:memory:` SQLite
- CLI with 8 commands (`ui`, `demo`, `list`, `show`, `replay`, `chaos`, `doctor`, `share`)
- Local dev dashboard (`Vite + Preact`) served at `/_vault/` with SSE live updates, Journey pipeline, DiffView, ChaosDial, Calm Mode, and lazy-loaded Confetti
- Express demo project in `examples/express-demo/`
