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

## Local / Compose staging

```bash
docker compose up -d
# if :5432 is busy: POSTGRES_HOST_PORT=5434 docker compose up -d
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
- Dev session mint (`POST /api/v1/auth/dev/session`) is forbidden in production

## Multi-region

Run one primary Postgres. API processes are stateless aside from the in-process rate limiter and webhook retry loop, so a second region needs a shared database and should not assume the limiter or retry loop is global. Do not active-active write to two databases. Put TLS and `X-Forwarded-For` on the reverse proxy in front of every region you do run.

## Rollback

1. Point the reverse proxy at the previous API release / container image
2. Keep Postgres migrations forward-only; do not drop Phase 1 columns
3. Confirm `/health/ready` and a single smoke deal create + receipt

## Workers

The API process runs the webhook retry loop in-process. No separate worker binary is required for Phase 1.
