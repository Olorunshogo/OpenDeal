# OpenDeal

**Bitcoin-native commerce coordination protocol.** Signed deal agreements, 2-of-3 multisig escrow, structured disputes, and portable receipts. The API coordinates deals and **never holds private keys**.

<p>
  <a href="./LICENSE"><img alt="MIT Licensed" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
  <img alt="Status: MVP" src="https://img.shields.io/badge/status-MVP-yellow.svg"/>
  <img alt="Network: regtest experimental" src="https://img.shields.io/badge/network-regtest%20experimental-orange.svg"/>
</p>

## What this is

A buyer and a seller who found each other online (WhatsApp, Jiji, social) need a way to trade without one party taking all the first-mover risk. OpenDeal:

1. Records a **canonical, dual-signed agreement**
2. Derives a **2-of-3 P2WSH escrow** (buyer, seller, mediator)
3. Verifies funding (script + amount + confirmations)
4. Coordinates **PSBT settlement** (payout or refund)
5. Exports an independently **verifiable receipt**

It is not another marketplace. Settlement adapters keep Lightning/fiat pluggable later, with honest custody labels.

See [`docs/protocol.md`](./docs/protocol.md), [`docs/threat-model.md`](./docs/threat-model.md), [`docs/recovery.md`](./docs/recovery.md), [`docs/mediator-policy.md`](./docs/mediator-policy.md), [`docs/testnet-pilot.md`](./docs/testnet-pilot.md), [`docs/mainnet-pilot.md`](./docs/mainnet-pilot.md), [`docs/rails.md`](./docs/rails.md), [`docs/compliance.md`](./docs/compliance.md), [`docs/security-review.md`](./docs/security-review.md), [`docs/roadmap.md`](./docs/roadmap.md), and [`docs/deploy.md`](./docs/deploy.md).

## Repository layout

| Path | Description |
| --- | --- |
| [`crates/opendeal-core`](./crates/opendeal-core) | Agreement, state machine, hash-chained events, verification |
| [`crates/opendeal-bitcoin`](./crates/opendeal-bitcoin) | P2WSH 2-of-3, funding verify, PSBT coordination |
| [`crates/opendeal-api`](./crates/opendeal-api) | Axum API and Postgres. No private keys. |
| [`frontend/`](./frontend) | Next.js buyer / seller / mediator UI |
| [`examples/regtest-demo`](./examples/regtest-demo) | Offline protocol demo and receipt verifier |
| [`docs/`](./docs) | Protocol, threat model, roadmap, demo recording notes |

Phased plan and status: [`docs/roadmap.md`](./docs/roadmap.md).

## Quick start

Requires Rust (stable), Node 24+, pnpm, Docker, Make.

Both `.env.example` files are committed templates. `cp -n` only writes the real file if it
doesn't exist yet, so this is safe to re-run.

```bash
cp -n crates/opendeal-api/.env.example crates/opendeal-api/.env
cp -n frontend/.env.example frontend/.env.local

make up                 # Postgres (:5434) + bitcoind
make install-frontend   # once
make api                # terminal 1 (runs migrations when RUN_MIGRATIONS=true)
make frontend           # terminal 2
```

That's the whole setup: two `cp` lines, `make up`, then the API and frontend each in their own
terminal. See `make help` for the full command list. Deploy notes: [`docs/deploy.md`](./docs/deploy.md).

API: `http://localhost:8080` · OpenAPI UI: `/docs` · Frontend: `http://localhost:3000`

Compose Postgres defaults to host port **5434** so it does not clash with a system Postgres on 5432. Override with `POSTGRES_HOST_PORT=5432` if needed, and match `DATABASE_*` in `.env`.

### Offline protocol smoke (no bitcoind)

```bash
cargo run -p regtest-demo -- laptop-sale
```

### Live regtest e2e (API + bitcoind wallets, off-server 2-of-3 PSBT)

```bash
docker compose up -d
# if host :5432 is busy: POSTGRES_HOST_PORT=5434 docker compose up -d
# match DATABASE_URL in crates/opendeal-api/.env to that port
cargo run -p opendeal-api   # other terminal
./scripts/live-regtest-e2e.sh
```

See [`docs/demo-recording.md`](./docs/demo-recording.md) for the pitch backup capture checklist.

## Settlement models

Set `SETTLEMENT_MODEL`:

- `bitcoin_multisig_2of3` (default / product truth)
- `lightning_provider` (Phase 3 seam, stub ready)
- `fiat_provider` (Phase 3 seam, stub ready)
- `simulated` (dev only; refused in production)

## Security boundaries

- Never store seed phrases or private keys in the API/DB
- Funding is confirmed only after script + amount + N confirmations
- Mediator cannot spend alone
- MVP is **regtest experimental**. Do not claim production readiness for real funds.

## License

MIT. See [`LICENSE`](./LICENSE).

## Backend integration

See [regtest setup](docs/regtest-backend.md), [API contract](docs/frontend-api-integration.md), and [validation results](docs/backend-integration-results.md).
