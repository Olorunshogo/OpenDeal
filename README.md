<p align="center">
  <img src="frontend/public/full-opendeal-logo-tr.png" alt="OpenDeal" width="320"/>
</p>

<h3 align="center">Trust-minimised escrow for peer-to-peer commerce, settled on Bitcoin.</h3>

<p align="center">
  Signed agreements · 2-of-3 multisig escrow · Structured disputes · Verifiable receipts<br/>
  <b>The server coordinates the deal. It never holds a key that can move the money.</b>
</p>

<p align="center">
  <a href="https://github.com/Olorunshogo/OpenDeal/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Olorunshogo/OpenDeal/actions/workflows/ci.yml/badge.svg"/></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"/></a>
  <img alt="Rust" src="https://img.shields.io/badge/backend-Rust%20%2B%20Axum-orange.svg"/>
  <img alt="Next.js" src="https://img.shields.io/badge/frontend-Next.js-black.svg"/>
  <img alt="Network: regtest" src="https://img.shields.io/badge/network-regtest%20experimental-yellow.svg"/>
</p>

---

## The problem

Millions of trades start in a WhatsApp chat, a Jiji listing, or a social media post. Then someone has to go first:

- The **buyer** pays and hopes the seller ships.
- The **seller** ships and hopes the buyer pays.

Centralised escrow fixes this by adding a company that holds everyone's money. That company becomes a single point of failure, a custody risk, and a gatekeeper.

## Our solution

**OpenDeal** lets two strangers trade safely without either of them, or us, holding the money.

1. Buyer and seller **sign the same agreement** (price, deadline, payout and refund addresses). Its hash becomes the deal ID.
2. The buyer funds a **2-of-3 multisig escrow** shared by buyer, seller, and an approved mediator.
3. The happy path needs **buyer + seller** to release the funds. If they disagree, the **mediator + one party** settle it. Nobody can move the money alone, including the mediator and the OpenDeal server.
4. Every step is recorded in a **hash-chained event log**, and the deal ends with a **portable receipt** anyone can verify.

OpenDeal is **a protocol and an API, not another marketplace**. Existing marketplaces can embed it instead of building escrow themselves.

## How it works

```mermaid
sequenceDiagram
    autonumber
    actor S as Seller
    actor B as Buyer
    participant API as OpenDeal API<br/>(no keys)
    participant BTC as Bitcoin

    S->>API: Create deal (terms, buyer, approved mediator)
    S->>API: Sign canonical agreement (in browser)
    B->>API: Sign the same agreement (in browser)
    Note over API: status: agreed<br/>escrow = 2-of-3 P2WSH(buyer, seller, mediator)
    B->>BTC: Fund escrow address
    API->>BTC: Verify script, amount, confirmations
    Note over API: status: funded
    S->>API: Mark shipped
    B->>API: Accept delivery
    S->>API: Propose payout PSBT (destination fixed by the agreement)
    S->>API: Partial signature (in browser)
    B->>API: Partial signature (in browser)
    API->>BTC: Finalize and broadcast 2-of-3 transaction
    Note over API: status: settled<br/>verifiable receipt exported
```

If the buyer disputes instead of accepting, both sides submit evidence and the mediator records a decision with its reasoning. That decision fixes which settlement (payout or refund) the mediator and one party may sign.

## Features

| | Feature | What it means |
|---|---|---|
| 🔑 | **Self-custodial identities** | Keys are generated in the browser and stored encrypted (PBKDF2 + AES-GCM). Sign-in is a signed Nostr challenge. The server never sees a private key. |
| 📝 | **Canonical signed agreements** | Both parties sign identical canonical bytes. The deal ID is the agreement's SHA-256. Changing any term means a new deal. |
| 🔐 | **2-of-3 P2WSH escrow** | Sorted-key multisig derived from the three identities. The browser and the TUI re-derive it independently, so a tampered address is caught. |
| ✅ | **Real funding checks** | Funding counts only after the right script, the exact amount, and the required confirmations. |
| ✍️ | **PSBT settlement** | The payout destination is locked to the signed agreement. Each party reviews outputs and fee, then signs locally. |
| ⚖️ | **Mediator registry and disputes** | Mediators register with a signed application and are approved by an admin. Evidence is hashed, and decisions carry their reasoning. |
| 🧾 | **Verifiable receipts** | Agreement, signatures, hash-chained events, and txids in one JSON file that can be checked offline. |
| 📋 | **My deals and live updates** | Each participant sees their deals and their role. Deal pages refresh on their own, and disabled actions explain why. |
| 🖥️ | **Prep TUI** | A Ratatui terminal tool loads public keys, picks a mediator, derives the escrow address, and exports a deal file for the web app. It never touches private keys. |
| 🔌 | **Integrator API** | OpenAPI 3 docs, idempotent deal creation, and signed webhooks. |

## Quick start

**You need:** Rust (stable), Node 24 and pnpm, Docker, Make, and a regtest Bitcoin node. [Polar](https://lightningpolar.com) is the easiest way to get one.

```bash
git clone https://github.com/Olorunshogo/OpenDeal.git && cd OpenDeal

cp -n .env.example .env
cp -n crates/opendeal-api/.env.example crates/opendeal-api/.env
cp -n frontend/.env.example frontend/.env.local

docker compose up -d postgres   # Postgres on 127.0.0.1:5435
make install-frontend           # first time only
```

Edit `crates/opendeal-api/.env`:

- Set `BITCOIN_RPC_URL`, `BITCOIN_RPC_USER`, and `BITCOIN_RPC_PASSWORD` to your node. In Polar these are on the Bitcoin node's **Connect** tab.
- Set `DATABASE_URL` and `DATABASE_ADMIN_URL` to `postgres://opendeal:opendeal@127.0.0.1:5435/opendeal`.
- Set `JWT_SECRET` to the output of `openssl rand -hex 32`.
- Add a mediator public key to `MEDIATOR_PUBKEYS` (see the demo guide).

<details>
<summary>No Polar? Use the bundled bitcoind instead</summary>

```bash
make up    # Postgres + bitcoind (regtest) on :18443, RPC user/password "opendeal"
```

Then set `BITCOIN_RPC_URL=http://127.0.0.1:18443` and `BITCOIN_RPC_USER`/`BITCOIN_RPC_PASSWORD=opendeal`. If Polar is also running, check the two don't use the same RPC port.
</details>

Run the app in two terminals:

```bash
make api        # terminal 1 → http://localhost:8080   (API docs: /docs)
make frontend   # terminal 2 → http://localhost:3000
```

## Demo in 5 minutes

You play the seller in a normal browser window and the buyer in an incognito window.

1. **Sign in** → **Create identity** in both windows. Each one downloads an encrypted recovery file.
2. In a third terminal, run `make btc-info` to confirm the helpers see the same node as the API, `make wallet` to get a funded wallet, then `make addresses` for a seller payout address and a buyer refund address.
3. *(Optional)* Run `make tui` to prepare the deal in the terminal, then import it under **New deal → Import prepared configuration**.
4. As the seller, create the deal. The buyer finds it under **My deals**. Both click **Sign agreement**.
5. As the seller, click **Prepare funding**. Run `make fund ADDR=<escrow address>`, then click **Verify funding**.
6. **Mark shipped**, then **Accept delivery**, then **Propose settlement**. Both parties **Sign**, then **Finalize**, then run `make mine`, then click **Check confirmation**.
7. Click **Verify receipt** and download the proof.

The bitcoind helpers (`make btc-info`, `wallet`, `addresses`, `fund`, `mine`, `btc`) read the API's `BITCOIN_RPC_*` settings, so they work the same with Polar or the bundled bitcoind. See [Using Polar](docs/demo.md#using-polar-instead-of-the-compose-bitcoind) and `make help`.

Step-by-step guides:
- [Quick demo](docs/quick-demo.md)
- [Full setup guide (Polar, env, TUI)](docs/teammate-demo-guide.md)
- [Disputes and the mediator flow](docs/demo.md)

## Architecture

```mermaid
flowchart LR
    subgraph Browser["Browser (keys live here)"]
        UI[Next.js app]
        K[(Encrypted identity)]
        UI --- K
    end
    TUI[opendeal-tui<br/>deal prep, public keys only] -. prepared deal JSON .-> UI
    UI -- signed requests --> API[opendeal-api<br/>Axum]
    API --> DB[(PostgreSQL)]
    API -- RPC --> BTC[(Bitcoin Core)]
    API --> CORE[opendeal-core<br/>agreements · state machine · events]
    API --> BITCOIN[opendeal-bitcoin<br/>P2WSH · funding · PSBT]
    TUI --> BITCOIN
```

| Path | What it is |
|---|---|
| [`crates/opendeal-core`](crates/opendeal-core) | Canonical agreements, deal state machine, hash-chained events, receipt verification |
| [`crates/opendeal-bitcoin`](crates/opendeal-bitcoin) | 2-of-3 P2WSH derivation, funding verification, PSBT build, validate, and finalize |
| [`crates/opendeal-api`](crates/opendeal-api) | Axum REST API on PostgreSQL. Auth, deals, disputes, evidence, mediators, webhooks. **Holds no private keys.** |
| [`crates/opendeal-tui`](crates/opendeal-tui) | Ratatui terminal tool for preparing demo deals |
| [`crates/rails-proxy`](crates/rails-proxy) | Sandbox for the HTTP invoice contract behind the Lightning and fiat adapters |
| [`frontend/`](frontend) | Next.js app for buyer, seller, and mediator, with in-browser signing |
| [`examples/regtest-demo`](examples/regtest-demo) | Offline protocol demo and receipt verifier |

**Stack:** Rust 2024 · Axum · SQLx · PostgreSQL · rust-bitcoin · Next.js · React · TypeScript · TanStack Query · @scure/btc-signer · Ratatui

## Security model

| Guarantee | How |
|---|---|
| The server cannot steal funds | It never holds or receives a spending key. Settlement needs 2 of the 3 participant keys. |
| The mediator cannot steal funds | The mediator holds one key of three, so it always needs the buyer or seller to co-sign. The API only builds the settlement its recorded decision allows. |
| No one can swap the payout address | The PSBT destination must equal the address in the dual-signed agreement. Each browser checks this before signing. |
| Sign-in proves key ownership | Each sign-in signs a fresh, one-time Nostr challenge. Sending a public key alone is never enough. |
| Keys stay off the network | Identities are encrypted at rest, kept unlocked only in tab memory, and never logged or exported in plain text. |
| Tamper-evident history | Each event commits to the hash of the previous one, and receipts can be verified offline. |

More detail: [threat model](docs/threat-model.md), [protocol](docs/protocol.md), [recovery](docs/recovery.md), [security review](docs/security-review.md).

> **Status: regtest experimental.** OpenDeal has not had an external security audit. Do not use it with real funds. Mainnet is blocked unless the operator explicitly sets `OPENDEAL_ALLOW_MAINNET` and `OPENDEAL_SECURITY_REVIEW_ACK`.

## Testing

```bash
make test                                   # core, bitcoin, and TUI unit tests
cargo test -p opendeal-api                  # API tests
cd frontend && pnpm test                    # frontend unit and policy tests
cargo run -p regtest-demo -- laptop-sale    # offline end-to-end protocol demo
```

The database integration suite runs against a disposable database it creates and drops itself:

```bash
OPENDEAL_TEST_ADMIN_URL=postgres://opendeal:opendeal@127.0.0.1:5435/postgres \
  cargo test -p opendeal-api -- --ignored
```

CI runs `cargo fmt`, `clippy -D warnings`, the Rust test suite, the frontend lint, and the production build on every pull request.

## Roadmap

- [x] Signed agreements, 2-of-3 escrow, PSBT settlement, and receipts on regtest
- [x] Self-custodial browser identities, mediator registry, and disputes with evidence
- [x] Deal-prep TUI, My deals, and live deal updates
- [ ] Testnet and signet pilot ([plan](docs/testnet-pilot.md))
- [ ] Lightning and fiat settlement adapters (the interfaces exist; providers are stubs) ([rails](docs/rails.md))
- [ ] Embeddable checkout for marketplaces
- [ ] External security review, then a capped mainnet pilot ([plan](docs/mainnet-pilot.md))

Full plan: [docs/roadmap.md](docs/roadmap.md)

## Documentation

| Topic | Docs |
|---|---|
| Run a demo | [Quick demo](docs/quick-demo.md) · [Full setup guide](docs/teammate-demo-guide.md) · [Click-through with disputes](docs/demo.md) · [TUI](docs/tui.md) |
| Protocol and security | [Protocol](docs/protocol.md) · [Threat model](docs/threat-model.md) · [Recovery](docs/recovery.md) · [Mediator policy](docs/mediator-policy.md) · [Security review](docs/security-review.md) |
| Integrate | [API contract](docs/frontend-api-integration.md) · OpenAPI UI at `http://localhost:8080/docs` · [Settlement rails](docs/rails.md) |
| Operate | [Deploy](docs/deploy.md) · [Regtest backend](docs/regtest-backend.md) · [Testnet pilot](docs/testnet-pilot.md) · [Mainnet pilot](docs/mainnet-pilot.md) · [Compliance](docs/compliance.md) |

## Team

| | Name | GitHub |
|---|---|---|
| 👤 | Olorunshogo Moses BAMTEFA | [Olorunshogo](https://github.com/Olorunshogo) |
| 👤 | Christopher Dominic | [Christopherdominic](https://github.com/Christopherdominic) |

## License

[MIT](LICENSE) © 2026 BAMTEFA Olorunshogo Moses.
