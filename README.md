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

See [`docs/protocol.md`](./docs/protocol.md), [`docs/threat-model.md`](./docs/threat-model.md), and [`docs/roadmap.md`](./docs/roadmap.md).

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

Requires Rust (stable), Node 24+, pnpm, Docker.

```bash
# 1. Postgres + bitcoind (regtest)
docker compose up -d

# 2. API
cd crates/opendeal-api
cp .env.example .env
cargo run -p opendeal-api

# 3. Frontend (new terminal)
cd frontend
cp .env.local.example .env.local
pnpm install
pnpm dev
```

API: `http://localhost:8080` · OpenAPI UI: `/docs` · Frontend: `http://localhost:3000`

### Offline protocol smoke (no bitcoind)

```bash
cargo run -p regtest-demo -- laptop-sale
```

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
