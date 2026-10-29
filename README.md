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
| [`crates/opendeal-tui`](./crates/opendeal-tui) | Optional Ratatui terminal tool that prepares demo data (public keys, escrow preview, deal terms). No private keys. |
| [`docs/`](./docs) | Protocol, threat model, roadmap, demo recording notes |

Phased plan and status: [`docs/roadmap.md`](./docs/roadmap.md).

## Quick start

Requires Rust (stable), Node 24+, pnpm, Docker (Docker Desktop must be running), Make.

Both `.env.example` files are committed templates. `cp -n` only writes the real file if it
doesn't exist yet, so this is safe to re-run.

```bash
cp -n .env.example .env
cp -n crates/opendeal-api/.env.example crates/opendeal-api/.env
cp -n frontend/.env.example frontend/.env.local

make up                 # Postgres (:5435) + bitcoind
make install-frontend   # once
make api                # terminal 1 (runs migrations when RUN_MIGRATIONS=true)
make frontend           # terminal 2
```

That's the whole setup: three `cp` lines, `make up`, then the API and frontend each in their own
terminal. See `make help` for the full command list. Deploy notes: [`docs/deploy.md`](./docs/deploy.md).

API: `http://localhost:8080` · OpenAPI UI: `/docs` · Frontend: `http://localhost:3000`

Compose Postgres defaults to host port **5435** (set by `POSTGRES_HOST_PORT` in the root `.env`) so it does not clash with a system Postgres on 5432 or other local Compose stacks. If you change it, match `DATABASE_*` in `crates/opendeal-api/.env`.

### Run and check the app

Full click-through with every button and expected result: [`docs/demo.md`](./docs/demo.md).

1. **Start the stack.** Open Docker Desktop and wait until it reports running, then:

   ```bash
   make up         # Postgres + bitcoind
   make api        # terminal 1, wait for it to listen on :8080
   make frontend   # terminal 2, then open http://localhost:3000
   ```

   The header status dot should be green (**API online**).

2. **Walk the demo.** Follow [`docs/demo.md`](./docs/demo.md) from Part 1 with one browser window per role (seller, buyer, mediator).

3. **Check responsive layouts.** In Chrome DevTools, toggle device mode (`Ctrl+Shift+M`, or `Cmd+Shift+M` on macOS) and check the deal, new deal, mediator, and checkout pages at:

   | Width | Represents | Expect |
   |---|---|---|
   | 375px | Phone | 16px side gutters, full-width buttons, single-column grids, no horizontal scroll |
   | 768px | Tablet | Buttons back in a row, two-column detail grids |
   | 1280px | Desktop | Deal page and Timeline side by side, mediator list beside the detail panel |

4. **Check auth and API status.**
   - Signed-out API calls are rejected:

     ```bash
     curl -i http://localhost:8080/api/v1/deals/<deal-id>    # expect 401
     ```

   - Opening a deal page while signed out shows **Sign in to view this deal**.
   - Stop `make api` while the app is open: a red **API offline** banner appears. Start it again and the banner clears by itself within about 10 seconds.
   - After 60 minutes a sign-in expires. The footer shows **Sign in again**, which keeps the same identity and signing key.

5. **Shut down.** `Ctrl+C` in both terminals, then `make down`. Data volumes are kept.

### Prepare demo data in the terminal (optional)

```bash
make tui        # needs make api running; see docs/tui.md
```

The TUI loads public keys from participants' recovery files (created at `/onboarding`), picks an approved mediator, derives the escrow address with `opendeal-bitcoin`, and exports validated terms. You then import them on `/deals/new` → **Import prepared configuration**. It never holds private keys and never creates or signs deals. Full guide: [`docs/tui.md`](./docs/tui.md).

### Offline protocol smoke (no bitcoind)

```bash
cargo run -p regtest-demo -- laptop-sale
```

### Live regtest e2e (API + bitcoind wallets, off-server 2-of-3 PSBT)

```bash
make up                     # Postgres + bitcoind
# Postgres binds host :5435; if that is busy, set POSTGRES_HOST_PORT in .env
# and match DATABASE_URL in crates/opendeal-api/.env to that port
OPENDEAL_DEV_SESSION_ENABLED=true make api   # other terminal; the CLI e2e signs in via the dev route
make e2e
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
