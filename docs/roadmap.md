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
| `docs/` | Protocol, threat model, recovery, mediator policy, deploy, demo notes, this roadmap |

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
| Live end-to-end regtest script (fund from wallets, off-server 2-of-3 PSBT sign) | Done (`scripts/live-regtest-e2e.sh` / `regtest-demo live-e2e`) |
| Frontend dual-sign agreement UX | Done (deal page agreement panel + local ECDSA) |
| In-UI Nostr login (not only paste JWT) | Done (NIP-07 + regtest identity; JWT paste in Advanced) |
| Backup screen recording for pitch | Done (checklist + terminal proof in `demo-recording.md`; UI mp4 optional outside git) |
| SEO / favicon / Open Graph assets | Done (`layout.tsx` metadata, icons, OG/twitter images) |

**Exit criterion:** Reproducible regtest demo; invalid transitions rejected; receipt verifies without trusting the API.

---

## Phase 1: Production foundation

**Goal:** Ops and integrator surface before real funds. Still not mainnet user money.

| Item | Status |
| --- | --- |
| Nostr challenge/login → JWT on mutating routes | Done (API + UI) |
| Idempotency-Key on funding/settlement mutations | Done (basic) |
| Signed webhooks | Done (sync attempt + retry worker) |
| OpenAPI /docs | Done (auth, deals, evidence, disputes, webhooks) |
| Structured tracing bootstrap | Done |
| Full OpenTelemetry export | Done (OTLP via `OTEL_EXPORTER_OTLP_ENDPOINT`) |
| Object storage for evidence (e.g. R2) | Done (R2 or local `EVIDENCE_DIR`) |
| Real email notifications (e.g. Resend) | Done (optional Resend; party emails on users) |
| Webhook retry job worker | Done (in-process backoff + dead-letter) |
| Secrets management, Sentry, deploy runbook | Done (`docs/deploy.md`, Sentry env-gated) |
| Environment gates (`simulated` refused in prod; mainnet flag) | Done |

---

## Phase 2: Real Bitcoin pilot

**Goal:** Testnet, then constrained mainnet with known counterparties.

| Item | Status |
| --- | --- |
| Testnet pilot | Done (ops-ready: [`testnet-pilot.md`](./testnet-pilot.md), `PILOT_MAX_AMOUNT_SATS`, `/api/v1/meta`, UI network banner) |
| Constrained mainnet pilot | Done (ops gates only: [`mainnet-pilot.md`](./mainnet-pilot.md); no live funds in this change) |
| Fee / dust policy hardening | Done (`FeeDustPolicy` in `opendeal-bitcoin`; enforced on create/prepare/propose) |
| PSBT review UX (“what am I signing?”) | Done (deal page: decode summary, review checkbox, local/paste sign, decline, finalize) |
| Timeout / recovery design (timelock or documented manual recovery) | Done (manual recovery default; timelock deferred; [`recovery.md`](./recovery.md)) |
| Mediator policy docs + support runbooks | Done ([`mediator-policy.md`](./mediator-policy.md)) |
| External security review of `opendeal-bitcoin` | Prep done ([`security-review.md`](./security-review.md)). Mainnet boot requires `OPENDEAL_SECURITY_REVIEW_ACK=1` as an operator attestation. This repo does not contain the external report. |

---

## Phase 3: Pluggable rails

**Goal:** Lightning/fiat as real adapters behind the same capability enum. Honest custody labels in UI.

| Item | Status |
| --- | --- |
| Settlement trait + `LightningProvider` / `FiatProvider` stubs | Done (dev stubs; production refuses them) |
| Real Lightning adapter (NWC / Bitnob / MavaPay or equivalent) | Done as an operator HTTP invoice client ([`rails.md`](./rails.md)); not a bundled Bitnob SDK |
| Real NGN fiat adapter (optional) | Done as the same HTTP invoice contract with `FIAT_API_*` |
| Embeddable checkout + toy marketplace integrator | Done (`/deals/{id}/checkout`, `/market`) |
| Reputation from verified deal events | Done (`GET /api/v1/deals/reputation/{pubkey}`) |

---

## Phase 4: Scale / hardening

**Goal:** Operate as infrastructure others depend on.

| Item | Status |
| --- | --- |
| Provider redundancy | Done (`BITCOIN_RPC_URL_FALLBACK` via `RedundantBitcoinRpc`) |
| Rate limits and abuse controls | Done (in-process `RATE_LIMIT_PER_MINUTE` on `/api/v1`) |
| Compliance assessment if any custodial rail is offered | Done as a checklist ([`compliance.md`](./compliance.md)); not a legal opinion |
| Multi-region ops | Done as a single-primary runbook note in [`deploy.md`](./deploy.md) |
| Formal dispute SLA | Done (written targets in [`mediator-policy.md`](./mediator-policy.md); not a contract) |

---

## Explicitly out of scope for now

- AI dispute adjudication
- Custom Lightning node / routing infra as a prerequisite
- Token or proprietary cryptocurrency
- Claiming trustless escrow when the path is simulated, Lightning provider, or fiat

---

## How to update this file

When a phase item ships, change its Status cell and, if useful, add a one-line note under the table. Keep the phase goals stable; move detail into `protocol.md` or ADRs if a decision needs a permanent record.
