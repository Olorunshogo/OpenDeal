# Deploy runbook

Staging-oriented ops for OpenDeal before real mainnet funds. Secrets never belong in git.

## Required secrets

Store these in your host secret store (Fly secrets, Doppler, age-encrypted env, or similar):

| Variable | Purpose |
| --- | --- |
| `JWT_SECRET` | JWT HMAC (min 32 chars) |
| `DATABASE_URL` | App Postgres URL |
| `DATABASE_ADMIN_URL` | Migration role (if `RUN_MIGRATIONS=true`) |
| `WEBHOOK_SIGNING_SECRET` | Fallback signing material for ops |
| `BITCOIN_RPC_URL` | Required in production for multisig |
| `MEDIATOR_PUBKEYS` | Comma-separated pubkeys (required in production) |
| `SENTRY_DSN` | Optional API error reporting |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional OTLP collector |
| `RESEND_API_KEY` / `EMAIL_FROM` | Optional email |
| `R2_BUCKET` / `R2_ENDPOINT` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Optional evidence object storage |

Frontend:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | Public API base |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL for metadata |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional browser Sentry |

## Frontend on Vercel

The Next.js app in `frontend/` deploys to Vercel as is. `frontend/vercel.json` pins the framework, a frozen-lockfile install, and the build command.

1. **Import the repository** in Vercel and set **Root Directory** to `frontend`. The repository root is not a Next.js app.
2. **Node.js version:** 24.x (also pinned by `engines` in `frontend/package.json`).
3. **pnpm:** `frontend/package.json` declares `packageManager: pnpm@12.16.1`. Add the environment variable `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses exactly that version.
4. **Environment variables** (Production and Preview). `NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them:

   | Variable | Example | Required |
   |---|---|---|
   | `NEXT_PUBLIC_API_URL` | `https://api.opendeal.example` | Yes. Without it the app falls back to `http://localhost:8080` |
   | `NEXT_PUBLIC_SITE_URL` | `https://opendeal.example` | Yes, for canonical and Open Graph URLs |
   | `NEXT_PUBLIC_BITCOIN_NETWORK` | `testnet` | Optional; the UI also reads `/api/v1/meta` |
   | `NEXT_PUBLIC_SENTRY_DSN` | | Optional |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Recommended |

5. **API side:** the Rust API is deployed separately (it needs Postgres and bitcoind). Add the Vercel domain, and any preview domains you use, to `CORS_ALLOWED_ORIGINS` in the API environment, or browser requests are blocked.

`vgpu` (the WebGPU engine behind the home page background) depends on `webgpu`, which ships native Node binaries. They are never bundled for the browser, and their build scripts are disabled in `frontend/pnpm-workspace.yaml`, so they only add install time. `/design` is an internal component reference: it is deployed but not linked from navigation and is marked `noindex`.

## Local / Compose staging

```bash
docker compose up -d
# Postgres binds host :5435; if that is busy: POSTGRES_HOST_PORT=<free port> docker compose up -d
cp -n crates/opendeal-api/.env.example crates/opendeal-api/.env
# align DATABASE_* ports with Compose
cargo run -p opendeal-api
```

Health:

- `GET /health` liveness
- `GET /health/ready` Postgres readiness
- `GET /api/v1/meta` network, settlement model, pilot amount cap
- OpenAPI UI: `/docs`

## Testnet pilot

Point the API at a synced testnet `bitcoind` (not the Compose regtest node):

```bash
BITCOIN_NETWORK=testnet
BITCOIN_RPC_URL=http://user:pass@127.0.0.1:18332
BITCOIN_REQUIRED_CONFIRMATIONS=1
PILOT_MAX_AMOUNT_SATS=100000
OPENDEAL_ALLOW_MAINNET=false
MEDIATOR_PUBKEYS=<known mediator hex pubkeys>
```

Frontend: set `NEXT_PUBLIC_BITCOIN_NETWORK=testnet` to match. Full checklist: [`testnet-pilot.md`](./testnet-pilot.md).

## Production gates

- `APP_ENV=production` refuses `SETTLEMENT_MODEL=simulated`
- Production Lightning/fiat refuses in-memory stubs (`LIGHTNING_API_URL` + key, or `FIAT_API_URL` + key)
- Mainnet requires the full gate set in [`mainnet-pilot.md`](./mainnet-pilot.md): production env, `OPENDEAL_ALLOW_MAINNET=1`, `OPENDEAL_SECURITY_REVIEW_ACK=1`, mediator and party allowlists, cap ≤ 100_000 sats, ≥ 3 confirmations, RPC URL
- Optional second node: `BITCOIN_RPC_URL_FALLBACK` (used when the primary RPC errors)
- `RATE_LIMIT_PER_MINUTE` (default 120, `0` disables) on `/api/v1`
- Dev session mint (`POST /api/v1/auth/dev/session`) is off unless `OPENDEAL_DEV_SESSION_ENABLED=true` and is refused in production

## Multi-region

Run one primary Postgres. API processes are stateless aside from the in-process rate limiter and webhook retry loop, so a second region needs a shared database and should not assume the limiter or retry loop is global. Do not active-active write to two databases. Put TLS and `X-Forwarded-For` on the reverse proxy in front of every region you do run.

## Rollback

1. Point the reverse proxy at the previous API release / container image
2. Keep Postgres migrations forward-only; do not drop Phase 1 columns
3. Confirm `/health/ready` and a single smoke deal create + receipt

## Workers

The API process runs the webhook retry loop in-process. No separate worker binary is required for Phase 1.
