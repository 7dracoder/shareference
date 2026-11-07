# Switchboard

A private inference pool and a marketplace for limited, revocable access to AI APIs, credits, and team-plan seats. Built for LOCALHOST NYC.

- **Inference pool:** one OpenAI-compatible key. The router sends each request to Superlinked SIE (fast), Darkbloom (private) or Tinfoil (verified), based on cost and privacy. SIE scans every request for personal data, and requests containing it go to Tinfoil automatically.
- **Account sharing without sharing accounts:** owners list an API key or a team-plan seat. Buyers get a grant limited to specific features and models, with a budget, a rate limit, a token cap and an expiry. Credentials are sealed with AES-256-GCM and never shown to anyone. Owners see usage counts, never prompts.
- **Direct payments, no middleman:** buyers pay the provider 90% directly by Zelle, Venmo, Cash App, PayPal or USDC on Base, and pay the 10% platform fee directly to you. For bank apps, each recipient confirms receipt. USDC payments are verified on-chain automatically. Switchboard never holds anyone's money.
- **Agents:** Policy Guard, Enforcer, Router, Finance, Reclaim and Optimizer. Each one writes metadata to its own dataset in cognee's shared memory.

## Run locally

```bash
cp .env.example .env.local   # fill in what you have; DEMO_MODE=true works with no keys
npm install
npm run dev                  # http://localhost:3000
```

The SQLite database and dev secrets go to `~/.switchboard`, or to `DATA_DIR` if set. Sign up with the email in `ADMIN_EMAIL` to unlock `/ops`.

## Pages

| Path | What |
|---|---|
| `/marketplace` | Pool and shared listings |
| `/orders/[id]` | Who to pay, how much, and the reference code |
| `/dashboard` | Buyer keys, budgets, usage, revoke |
| `/provider` | Payout handles, listings, confirm receipts, set limits, assign seats, revoke |
| `/ops` | Admin view: real revenue, fee confirmations, agent activity, optimizer, integrations |
| `/verify` | Live Tinfoil attestation and the trust model |
| `/playground` | Try a key in the browser |

## API (OpenAI-compatible)

`POST /api/v1/chat/completions` (with streaming), `POST /api/v1/embeddings`, `POST /api/v1/rerank`, `GET /api/v1/models`.
For pool keys, pick a tier with the `x-switchboard-tier: fast|private|verified` header or `model: "switchboard-<tier>"`.

## Deploy as a Tinfoil Container

1. Push this repo to a **public** GitHub repo.
2. Build and push the image (`Dockerfile`), then put its `@sha256:` digest in `tinfoil-config.yml`.
3. Add the release workflows from `tinfoilsh/tinfoil-containers-template`, then cut a release.
4. Set the variables and secrets listed in `tinfoil-config.yml` in the Tinfoil dashboard.

Note: the `/data` volume in the enclave is in memory, so data resets when the container restarts. For persistence, attach a Tinfoil persistent volume.

## Dev tooling

Rules and skills from [affaan-m/ECC](https://github.com/affaan-m/ECC) are installed in `.kiro/steering` and `.kiro/skills` (MIT, see `.kiro/ECC-LICENSE`).
