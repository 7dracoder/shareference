# Shareference

**Share the AI access you're not using. Buy only the access you need.**

Lots of people pay for AI API credit or team-plan seats they don't fully use. Shareference lets them **provide** that leftover access to someone else, safely: the buyer gets their own key with a budget and limits, the provider's credentials stay sealed, and either side can end it at any time. Shareference also runs its own **private inference pool**, so a buyer can get one key that works without a provider.

Live: [shareference-app.vercel.app](https://shareference-app.vercel.app)

## What you can share

| Kind | Examples | What the buyer gets |
|---|---|---|
| **API key / credits** | Claude (Anthropic API), OpenAI, Google Gemini, **Baseten**, OpenRouter, Groq, Together, Fireworks, DeepInfra, Mistral, **xAI (Grok)**, DeepSeek, Cerebras, Perplexity, Cohere, Hugging Face, Nebius, SambaNova, Novita, Darkbloom, Tinfoil, or any other OpenAI-compatible API | A Shareference key (`shr_...`) that forwards to the provider's account, with a budget, rate limit, token cap, model list and expiry. Providers pick the service (logo + name) and paste their key |
| **Team seat** | Claude Team, ChatGPT Business, **Cursor Teams**, GitHub Copilot Business, Canva, Figma, Notion, or any other team plan | Time-boxed seat. The provider adds and removes the buyer in that service's admin console; Shareference tracks the time |
| **Your computer** | Ollama or LM Studio on the machine you own | Buyers rent hours. Specs (CPU, RAM, GPU, free disk, OS) and installed models show on the listing. Access ends when the hours run out, or when you stop the agent / revoke |
| **Inference pool** (by Shareference) | OpenRouter (DeepSeek) by default; optional Darkbloom; Tinfoil for personal data | One key routed by cost and privacy (see below) |

**Personal subscriptions (Claude Pro/Max, ChatGPT Plus, and similar) can't be shared.** They have no API key, so sharing one means handing over your login, which those services forbid and can ban accounts for. Share API credit or a team-plan seat instead. Providers must also confirm they're allowed to share under each service's terms.

The supported list lives in `src/lib/policy.ts`. The listing form shows each service with a logo mark; Baseten, Grok (xAI) and Cursor Teams are called out first because those are the ones we're listing first.

### Share your own computer

1. On **Share**, click **Connect a computer**. Run the one-line command it shows (needs Node.js 18+).
2. Start Ollama or LM Studio with at least one model. The agent reports your specs and models.
3. Create a **My computer** listing with an hourly price. Buyers see GPU/CPU/RAM/disk and which models are installed.
4. Leave the terminal open while you want to be available. Closing it (or pressing Ctrl+C) takes you offline. When a buyer's hours end, their key stops working.

Requests run on your machine, so you can see buyers' prompts. The listing page warns them about that.

## How it works

**For buyers (getters)**

1. Pick a listing in **Get access** and choose how much credit to buy.
2. Sign up with your email and name. You land back on the listing.
3. The order page shows exactly who to pay and how much, with a reference code for the memo.
4. Once the payment is confirmed, your key appears in **My access**. Use it with any OpenAI-compatible app, or try it in the browser.
5. See remaining credit and usage at any time. End access whenever you want.

**For providers**

1. In **Provide access**, add how you want to be paid (only methods buyers can actually use are shown).
2. Create a listing: pick the service, paste your API key, set the models, price and default limits. For Darkbloom and Tinfoil you only paste the key.
3. When a buyer pays, confirm you received it. Access starts once you and the platform have both confirmed.
4. See each buyer's usage (never their prompts), tighten limits, or revoke instantly.

**For the platform owner (admin)**

Sign in with the email in `ADMIN_EMAIL` to open **Admin** (`/ops`): revenue, platform-fee confirmations, agent activity and integration status.

## Money

Shareference never holds anyone's money. Each order has two direct payments:

- **90% to the provider**, to their Zelle, Venmo, Cash App, PayPal or USDC address.
- **10% platform fee to the platform**, to the `PLATFORM_*` handles. Set with `PLATFORM_FEE_BPS`.

For bank and payment apps, each recipient confirms receipt. USDC on Base is verified on-chain automatically. A buyer can only pay with a method that **both** the provider and the platform accept. If the platform only has Zelle set, buyers can only pay with Zelle.

## Safety and limits

- Provider credentials are encrypted with AES-256-GCM (`VAULT_KEY`) and never shown again, even to the provider.
- Every key has a budget, requests-per-minute, max tokens per request, allowed models and an expiry. Spending is reserved before the call, so concurrent requests can't overspend.
- If an upstream call fails, the buyer isn't charged.
- Revoking a key takes effect on the next request.
- Providers see usage counts, never prompts or outputs.

## The inference pool

One key, three tiers. The router picks the cheapest tier that meets the buyer's privacy floor and only ever falls back to a more private tier, never a less private one.

| Tier | Backend | Notes |
|---|---|---|
| `fast` | OpenRouter (`deepseek/deepseek-v4.1-flash-1017` by default) | Everyday chat for the pool |
| `private` | Darkbloom (optional) | Only if you configure Darkbloom keys |
| `verified` | Tinfoil | Runs in an attested enclave; see `/verify` |

If SIE is configured, it scans pool requests for personal data. If it finds some, or can't check, the request is moved to Tinfoil automatically.

### Why the platform needs its own AI keys

`OPENROUTER_*`, optional `DARKBLOOM_*`, `TINFOIL_*` and optional `SIE_*` belong to the platform, not to providers. They're only used for:

- the **inference pool** listing (the platform sells inference itself),
- the **personal-data check** and the `/api/v1/embeddings` and `/api/v1/rerank` endpoints (SIE, if set),
- the live enclave check on **`/verify`** (Tinfoil).

Provider listings always use the provider's own key. Without OpenRouter (or another configured pool backend), the marketplace still works; only the pool can't be bought.

## API (OpenAI-compatible)

```bash
curl https://shareference-app.vercel.app/api/v1/chat/completions \
  -H "Authorization: Bearer shr_..." \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}'
```

- `POST /api/v1/chat/completions` (supports `"stream": true`)
- `POST /api/v1/embeddings`, `POST /api/v1/rerank`, `GET /api/v1/models`
- Pool keys: choose a tier with the `x-shareference-tier: fast|private|verified` header or `"model": "shareference-<tier>"`.

## Pages

| Path | What |
|---|---|
| `/marketplace` | All listings, including the pool |
| `/orders/[id]` | Who to pay, how much, and the reference code |
| `/dashboard` | Buyer keys, remaining credit, usage, end access |
| `/provider` | Payout methods, computers, listings, confirm payments, limits, seats, revoke |
| `/playground` | Try a key in the browser |
| `/guide` | How it works |
| `/verify` | Live Tinfoil attestation and the trust model |
| `/ops` | Admin only |

## Agents

Small server-side agents keep things running: **Policy Guard** (checks listings), **Enforcer** (seats, revocation), **Router** (pool routing), **Finance** (payments) and **Optimizer** (flags idle access and low budgets). They log metadata only. With cognee configured, each writes to its own shared-memory dataset.

## Run locally

```bash
cp .env.example .env.local   # DEMO_MODE=true works with no payment or AI keys
npm install
npm run dev                  # http://localhost:3000
```

You need Postgres (`DATABASE_URL`) and Clerk keys. Tables are created automatically on the first request.

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres (Neon on Vercel) |
| `VAULT_KEY` | yes in production | Encrypts provider credentials |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | yes | Login |
| `ADMIN_EMAIL` | yes | Who can open `/ops` |
| `PLATFORM_ZELLE` / `_VENMO` / `_CASHAPP` / `_PAYPAL` / `_USDC_ADDRESS` | at least one | Where the platform fee goes; also limits which methods buyers can use |
| `PLATFORM_FEE_BPS` | no | Fee in basis points (default 1000 = 10%) |
| `APP_URL` | no | Public site address |
| `DEMO_MODE` | no | Fake payments and mock models for local dev. The app refuses to start in production if it's `true` |
| `PROVIDER_UPSTREAM_HOSTS` | no | Extra hostnames providers may use, comma separated |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | for the pool | Platform pool "fast" tier |
| `TINFOIL_*` | recommended | Verified pool tier + `/verify` |
| `DARKBLOOM_*`, `SIE_*` | no | Optional private tier / embeddings / personal-data scan |
| `COGNEE_BASE_URL`, `COGNEE_API_KEY`, `COGNEE_TENANT_ID` | no | Shared agent memory |

See `.env.example` for every option.

## Deploy

**Vercel:** connect the repo, add the Neon integration for Postgres, set the variables above for Production, and deploy. For a public launch, use a Clerk **production** instance on your own domain; development keys show a "Development mode" badge and allow 100 users.

**Tinfoil Container** (optional; runs the app inside an attested enclave):

1. Push this repo to a **public** GitHub repo.
2. Build and push the image (`Dockerfile`), then put its `@sha256:` digest in `tinfoil-config.yml`.
3. Add the release workflows from `tinfoilsh/tinfoil-containers-template`, then cut a release.
4. Set the variables and secrets listed in `tinfoil-config.yml` in the Tinfoil dashboard.

## Dev tooling

Rules and skills from [affaan-m/ECC](https://github.com/affaan-m/ECC) are installed in `.kiro/steering` and `.kiro/skills` (MIT, see `.kiro/ECC-LICENSE`).
