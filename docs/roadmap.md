# OpenDeal roadmap

Living status for the production + MVP plan. North star: Bitcoin 2-of-3 multisig coordination (API never holds keys). Lightning/fiat stay behind a labeled settlement seam.

Source of truth for layout: repo root [`README.md`](../README.md). Protocol details: [`protocol.md`](./protocol.md). Threats: [`threat-model.md`](./threat-model.md).

## Current layout

| Path | Role |
| --- | --- |
| `crates/opendeal-core` | Agreements, state machine, events, receipt verification |
| `crates/opendeal-bitcoin` | P2WSH 2-of-3, funding verify, PSBT coordination |
| `crates/opendeal-api` | Axum API + Postgres (this is the backend you run) |
| `frontend/` | Next.js buyer / seller / mediator UI |
| `examples/regtest-demo` | Offline protocol demo + receipt verifier |
| `docs/` | Protocol, threat model, demo notes, this roadmap |

```bash
docker compose up -d
cargo run -p opendeal-api
cd frontend && pnpm dev
```

---

## Phase 0: MVP (hackathon / first public demo)

**Goal:** One laptop trade on regtest. Happy path + mediator-assisted refund. Independently verifiable receipt. Labeled experimental.

| Item | Status |
| --- | --- |
| Cargo workspace (`opendeal-core`, `opendeal-bitcoin`, `opendeal-api`) | Done |
| Agreement canonicalization, state machine, hash-chained events, tests | Done |
| Regtest 2-of-3 P2WSH, funding verify, PSBT propose/combine/broadcast (no server keys) | Done |
| API: deals, evidence, disputes, events, receipt | Done |
| Settlement capability trait (Multisig + Simulated) | Done |
| Frontend: landing, new deal, deal timeline, mediator desk, regtest labels | Done |
| `protocol.md`, `threat-model.md`, `demo-recording.md`, README | Done |
| Offline `regtest-demo` laptop-sale + receipt verify | Done |
| CI (Rust + frontend), Compose (Postgres + bitcoind) | Done |
| Live end-to-end regtest script (fund from wallets, off-server 2-of-3 PSBT sign) | Not done |
| Frontend dual-sign agreement UX | Not done |
| In-UI Nostr login (not only paste JWT) | Not done |
| Backup screen recording for pitch | Not done |
| SEO / favicon / Open Graph assets | Not done |

**Exit criterion:** Reproducible regtest demo; invalid transitions rejected; receipt verifies without trusting the API.

---

## Phase 1: Production foundation

**Goal:** Ops and integrator surface before real funds. Still not mainnet user money.

| Item | Status |
| --- | --- |
| Nostr challenge/login → JWT on mutating routes | Done (API); UI login incomplete |
| Idempotency-Key on funding/settlement mutations | Done (basic) |
| Signed webhooks | Done (best-effort delivery) |
| OpenAPI /docs | Done (thin; expand paths) |
| Structured tracing bootstrap | Done |
| Full OpenTelemetry export | Not done |
| Object storage for evidence (e.g. R2) | Not done |
| Real email notifications (e.g. Resend) | Not done |
| Webhook retry job worker | Not done |
| Secrets management, Sentry, deploy runbook | Not done |
| Environment gates (`simulated` refused in prod; mainnet flag) | Done |

---

## Phase 2: Real Bitcoin pilot

**Goal:** Testnet, then constrained mainnet with known counterparties.

| Item | Status |
| --- | --- |
| Testnet pilot | Not done |
| Constrained mainnet pilot | Not done |
| Fee / dust policy hardening | Not done |
| PSBT review UX (“what am I signing?”) | Not done |
| Timeout / recovery design (timelock or documented manual recovery) | Not done |
| Mediator policy docs + support runbooks | Not done |
| External security review of `opendeal-bitcoin` | Not done |

---

## Phase 3: Pluggable rails

**Goal:** Lightning/fiat as real adapters behind the same capability enum. Honest custody labels in UI.

| Item | Status |
| --- | --- |
| Settlement trait + `LightningProvider` / `FiatProvider` stubs | Done (stubs only) |
| Real Lightning adapter (NWC / Bitnob / MavaPay or equivalent) | Not done |
| Real NGN fiat adapter (optional) | Not done |
| Embeddable checkout + toy marketplace integrator | Not done |
| Reputation from verified deal events | Not done |

---

## Phase 4: Scale / hardening

**Goal:** Operate as infrastructure others depend on.

| Item | Status |
| --- | --- |
| Provider redundancy | Not done |
| Rate limits and abuse controls | Not done |
| Compliance assessment if any custodial rail is offered | Not done |
| Multi-region ops | Not done |
| Formal dispute SLA | Not done |

---

## Explicitly out of scope for now

- AI dispute adjudication
- Custom Lightning node / routing infra as a prerequisite
- Token or proprietary cryptocurrency
- Claiming trustless escrow when the path is simulated, Lightning provider, or fiat

---

## How to update this file

When a phase item ships, change its Status cell and, if useful, add a one-line note under the table. Keep the phase goals stable; move detail into `protocol.md` or ADRs if a decision needs a permanent record.
