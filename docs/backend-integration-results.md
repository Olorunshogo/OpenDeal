# Backend integration implementation and validation

## Initial audit

See [the initial audit](backend-audit.md). Existing protocol and Bitcoin primitives
were implemented, and the task supplied successful library-level transaction
IDs. API gaps were authorization, agreement acceptance, unsafe state transitions,
PSBT validation/finalization, atomic events, confirmation/reorg handling,
mediator authorization, receipts, documentation and API integration coverage.
The supplied previous transaction IDs are not transactions executed in this run.

## Implemented behavior

Nostr nonce login and JWT identity are retained. Private deal, event, receipt,
evidence and dispute reads now require actual participation. Role checks derive
from stored participants, with normalized curve identities. Unknown request and
signature fields are rejected; no private-key API was added. Challenges are
bounded, expire, cannot be replayed and require current signed events. Production
requires explicit HTTPS CORS and rejects the development JWT placeholder.

Creation supports signed description and payout/refund destinations. Optional
terms are omitted when absent to retain historical canonical serialization.
Public keys, amount, deadlines, window, network/model and addresses are checked.
Stored agreement hashes/participants/monetary metadata are checked against row
metadata. Buyer and seller signatures are reverified before sensitive operations,
including legacy rows incorrectly labeled agreed. Generic transitions cannot
bypass signing, funding or confirmation. Shipping is seller-only; acceptance is
buyer-only.

Prepared escrow uses the existing script builder. Core's actual network and
funding script, outpoint, amount and confirmations are checked. The script stays
unchanged. Its key-only determinism requires a fresh participant-key combination
for each agreement: addresses and funding outpoints cannot be reused across
deals. RPC amount parsing now uses precise decimal-to-integer satoshis.

Payout requires acceptance; refund/payout from disputes requires the assigned
mediator's matching immutable resolution. Destinations must be signed agreement
terms. Absolute and relative fee limits apply. Proposals are frozen. External
PSBT updates must preserve the unsigned transaction and trusted input metadata;
only verified SIGHASH_ALL signatures belonging to escrow keys are copied. The
server finalizes a sorted witness without signing. Signing progress is available.

Broadcast writes deterministic transaction intent before the RPC side effect.
Repeated finalization cannot create another broadcast. Rejections/uncertainty do
not claim confirmation. A separate observation endpoint checks actual Core
inclusion/active-chain confirmation and reconciles reorganizations. Dispute
decisions authorize outcomes without marking Bitcoin spent. Receipts bind
agreement ID, network/model, valid party signatures, event ordering, status and
transaction metadata. Evidence hashes are persisted and included in events.

Mutations lock the deal row and commit state/events together. Event timestamps
use PostgreSQL microsecond precision. Genesis sequencing is serialized by the
parent lock. Receipt reads use a repeatable-read snapshot. Creation keys are
actor-scoped, body-bound and atomically recorded. Webhooks now use an atomic
outbox; synchronous fetching of user-controlled URLs was removed.

## Migration

`crates/opendeal-api/migrations/20261022000002_backend_lifecycle.sql` adds durable
proposal/purpose, broadcast transaction/intent, phase, confirmation/block and
pre-settlement status fields; nullable evidence hashes; and uniqueness indexes
for open disputes, funding outpoints and escrow addresses. The initial migration
is unchanged. No table/data deletion or automatic historical rewrite occurs.

It was applied successfully to fresh disposable databases during API tests.
It was **not applied to the existing application database**. Review and reconcile
existing duplicate addresses/outpoints/open disputes before applying the indexes.
Existing malformed or inconsistent agreements/events fail validation rather than
being silently repaired. Database roles must have appropriate grants on new
objects. Migrations and application connections must target the same database.

## Endpoints and frontend integration

The full list of 25 operations, methods, payloads, response examples, status and
role policies, canonical signing rules and exact commands is in
[the frontend API contract](frontend-api-integration.md). Swagger now describes
all actual routes, including the new agreement, funding, signing-progress and
settlement-confirmation reads/actions. Existing route families and response
envelopes remain; state/security behavior is intentionally stricter.

Olorunshogo should implement local canonical agreement and PSBT signing, signed
destination collection, even-Y escrow key handling, role-specific actions and
confirmation polling. A broadcast txid must not render as confirmed. No frontend
files were modified.

## Validation results

Final checks executed in this session:

| Check | Result |
| --- | --- |
| `cargo fmt --all --check` | Passed |
| `cargo check --workspace` | Passed |
| `cargo test --workspace` | Passed; 23 offline tests executed |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passed |
| Explicit disposable PostgreSQL/Axum HTTP suite | Passed, including migration and database cleanup |
| Explicit authenticated live `getblockcount` test | Passed: height 367 |
| Read-only Core network/wallet audit | regtest; loaded wallets `""`, `miner` |
| Existing live library funding/settlement test | Ignored; not rerun |
| New live HTTP API funding/settlement test | Passed once after explicit user approval; actual HTTP, Core and disposable PostgreSQL |

The workspace's read-only connectivity test initially skipped because variables
were not exported into that command. It was then explicitly executed with local
credentials and passed. The database test is ignored in normal workspace runs
and was explicitly run separately. The API lifecycle remained ignored in the ordinary workspace run, then passed
when explicitly executed after user approval. The old library live test was not
rerun. Earlier test-harness/OpenAPI/cleanup failures were corrected; final runs
pass. Three databases left by early harness failures were explicitly removed;
subsequent test runs cleaned up their own databases. Existing application records,
Polar configuration/containers and `.env` were not modified.

The database suite covers real Nostr/JWT authentication and replay rejection,
private-read authorization, role escalation, creation validation and idempotency,
legacy mediator-signature acceptance rejection, valid/invalid/duplicate agreement
signatures, funding amount/confirmation thresholds, modified PSBT outpoints,
invalid participant/nonparticipant signatures, concurrent signature exchange,
fee/destination/purpose policy, duplicate broadcast prevention, confirmation,
reorganization, evidence privacy/hashes, dispute decisions, refunds and receipts.
Offline Bitcoin tests independently verify witness signature ordering and reject
input/output/metadata/sighash tampering and insufficient signatures. Every
protected Swagger operation is checked against the actual router for HTTP 401.

## Live demonstration

The ignored `tests::live_api::live_api_regtest` test starts an actual loopback HTTP
listener and a fresh disposable PostgreSQL database, authenticates local buyer
and seller identities, signs agreements locally, funds 100,000 sats through the
existing Core wallet, verifies funding via the API, ships/accepts, coordinates
local PSBT signatures through HTTP, finalizes/broadcasts through HTTP, mines and
verifies the payout and independent receipt. Expected payout is 99,000 sats;
settlement fee is 1,000 sats; actual funding fee and confirmations are printed.

The user explicitly approved one live API run. It succeeded on its first run,
with no automatic retries, using the existing `miner` wallet. Its disposable
PostgreSQL database was successfully removed afterward.

- Agreement ID: `a0ede334d587a7b177769c5875e3739fb53caf7caa9ee52610ce8c8ee802c388`
- Funding outpoint: `fa895503131b7c6a7703eef9b7d416fef7876d79d251e8d607dc1af226b8486e:1`
- Funding amount: 100,000 sats; actual funding fee: 330 sats.
- Funding confirmations at the funding check: 1.
- Settlement transaction: `5d386f017750f82a231f174ba32317dd7ab0dd2031d3bf09ec7a6ddac71b5919`
- Confirmed payout: 99,000 sats; settlement fee: 1,000 sats.
- Settlement confirmations at the final check: 1.
- Final API state: `settled`; settlement phase: `confirmed`.
- Independent receipt verification: passed.

These are API-driven transactions executed in this session, distinct from the
previous library-only transaction IDs supplied in the task. Core independently
validated the actual confirmed transaction, input, output script and amount. The
API did not receive any test private keys. The exact command is in the frontend
guide. A future failure after funding must not trigger an automatic rerun.

## Remaining limitations

- The live HTTP happy path passed once on regtest. Live rejection/reorganization
  scenarios were not induced on Polar; reorg/refund paths were tested with a mock
  RPC and real disposable PostgreSQL instead.
- Confirmation/reorg checks require polling; without txindex, supply a verified
  inclusion-block hint. RPC lookup failure is conservative uncertainty.
- Broadcast failure/crash recovery is manual; no automatic rebroadcast, replacement
  or fee bump protocol is implemented. Proposals remain frozen.
- Fresh participant key combinations are required for unique escrow association.
  Separating reusable login identities from per-deal escrow keys would need a
  separately signed protocol extension.
- Existing agreements without signed destination terms cannot be settled to a
  caller-chosen address. Historical broken receipts need explicit investigation.
- Evidence is access-controlled but stored in plaintext. Do not upload secrets.
- Event hash chains are unsigned server observations, not externally anchored
  attestations or Bitcoin inclusion proofs. Verify real transactions with a node.
- No expiry/automatic acceptance, webhook delivery, or background reconciliation
  worker is implemented. Timing terms are recorded for parties/dispute review.
- Nonces are in-memory and require instance affinity in a multi-instance service;
  production still needs request throttling, secret management and operations
  review. These tests do not establish production readiness for real funds.
- Lightning/fiat/simulated seams remain; the completed API lifecycle accepts the
  Bitcoin multisig model only rather than exposing provider stubs as payment.

## Files changed in this implementation

- `Cargo.lock`
- `README.md`
- `crates/opendeal-api/.env.example`
- `crates/opendeal-api/Cargo.toml`
- `crates/opendeal-api/migrations/20261022000002_backend_lifecycle.sql` (new)
- `crates/opendeal-api/src/auth/models.rs`
- `crates/opendeal-api/src/auth/nostr.rs`
- `crates/opendeal-api/src/config.rs`
- `crates/opendeal-api/src/deals/events.rs`
- `crates/opendeal-api/src/deals/handlers.rs`
- `crates/opendeal-api/src/deals/mod.rs`
- `crates/opendeal-api/src/deals/models.rs`
- `crates/opendeal-api/src/deals/service.rs`
- `crates/opendeal-api/src/disputes/mod.rs`
- `crates/opendeal-api/src/error.rs`
- `crates/opendeal-api/src/evidence/mod.rs`
- `crates/opendeal-api/src/idempotency.rs`
- `crates/opendeal-api/src/lib.rs`
- `crates/opendeal-api/src/openapi.rs`
- `crates/opendeal-api/src/state.rs`
- `crates/opendeal-api/src/webhooks.rs`
- `crates/opendeal-api/src/tests.rs` (new)
- `crates/opendeal-api/src/tests/live_api.rs` (new)
- `crates/opendeal-bitcoin/Cargo.toml`
- `crates/opendeal-bitcoin/src/error.rs`
- `crates/opendeal-bitcoin/src/escrow.rs` (distinct-key validation; script unchanged)
- `crates/opendeal-bitcoin/src/psbt.rs`
- `crates/opendeal-bitcoin/src/rpc.rs`
- `crates/opendeal-bitcoin/tests/psbt_security.rs` (new)
- `crates/opendeal-core/src/agreement.rs`
- `crates/opendeal-core/src/event.rs`
- `crates/opendeal-core/src/receipt.rs`
- `crates/opendeal-core/src/verification.rs`
- `examples/regtest-demo/src/main.rs` (optional-term compatibility)
- `docs/backend-audit.md` (new)
- `docs/frontend-api-integration.md` (new)
- `docs/backend-integration-results.md` (new)

Pre-existing `docker-compose.yml` edits and prior test/document artifacts were
preserved. This report records implementation validation before Git delivery.
