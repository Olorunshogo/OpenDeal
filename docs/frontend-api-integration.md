# OpenDeal frontend API integration

For Olorunshogo: use `http://localhost:8080/api/v1` in local development.
Swagger is `/docs/` and the machine contract is `/api-docs/openapi.json` (paths
include `/api/v1`). The frontend receives no Bitcoin RPC credentials. The API
has no signing-key, seed, mnemonic, wallet import, or key-generation endpoint.
Request DTOs reject unknown fields, including private-key fields. Never place
secrets in descriptions, evidence, PSBT proprietary fields, or application logs.

## Authentication and headers

1. `POST /auth/nostr/challenge` with `{"pubkey":"<64-hex-xonly-key>"}`.
2. Response is `{"message":"challenge issued","success":true,"data":{"nonce":"<uuid>","expires_at":"<UTC timestamp>"}}`.
3. Locally sign a Nostr event of kind **22242**, content exactly the nonce, with
   the identity's Schnorr key. Use a current `created_at` (within five minutes).
4. `POST /auth/nostr/login` with `{"event":{"id":"<event-hash>","pubkey":"<xonly>","created_at":1796083200,"kind":22242,"tags":[],"content":"<nonce>","sig":"<schnorr-signature>"}}`.
5. Response is `{"message":"logged in","success":true,"data":{"token":"<JWT>","pubkey":"<xonly>"}}`.

Nonces expire after five minutes and are single-use. Keep private keys in the
user's signer. JWTs are bearer credentials: use HTTPS outside loopback, keep them
out of URLs/logs, and send `Authorization: Bearer <JWT>`. Browser deployment must
set explicit `CORS_ALLOWED_ORIGINS`; production requires HTTPS origins.

Use `Content-Type: application/json` on JSON requests. `Idempotency-Key` (1–128
characters) is supported for deal creation: a repeated key with the same body and
identity returns the same resource; a changed body conflicts. Retries return the
current deal, rather than replaying an obsolete response. Other mutations use
locked state and natural identifiers; do not assume arbitrary bodies are cached.

## Response contract

Successful operations return HTTP 200:

```json
{"message":"deal created","success":true,"data":{"id":"<agreement-id>","status":"draft","title":"Laptop","amount_sats":100000,"currency":"BTC","seller_pubkey":"<seller-xonly>","buyer_pubkey":"<buyer-xonly>","mediator_pubkey":"<mediator-xonly>","settlement_model":"bitcoin_multisig_2of3","network":"regtest","escrow_address":null,"funding_txid":null,"funding_vout":null,"funding_amount_sats":null,"settlement_txid":null,"current_psbt":null,"settlement_purpose":null,"settlement_proposal":null,"settlement_phase":"none","settlement_confirmations":0,"settlement_block_hash":null,"settlement_from_status":null,"broadcast_attempted_at":null,"delivery_deadline":"<UTC timestamp>","acceptance_window_hours":24,"created_at":"<UTC timestamp>","updated_at":"<UTC timestamp>"}}
```

Errors from services use `{"message":"<reason>","success":false,"code":null}`
(or a specific code). Codes include `illegal_transition`, `settlement_locked`,
`settlement_not_authorized`, `funding_unavailable`, `duplicate_resource`,
`broadcast_unconfirmed`, `broadcast_rejected`, `dispute_resolved`, and `idempotency_conflict`.
HTTP 400 is validation failure, 401 invalid/missing JWT, 403 unauthorized role,
404 missing resource, and 409 state/concurrency conflict. Malformed JSON, missing
fields, invalid field types and unknown fields may return Axum's HTTP 422 text
rejection; body limits/timeouts may also use framework responses. Check HTTP
status before parsing an envelope. Internal failures return a generic HTTP 500.

## Actual endpoints

Paths below are relative to `/api/v1`. Every route except authentication requires
JWT authentication. Private reads require buyer, seller, or this deal's mediator;
JWTs carry identities, not trusted role claims.

| Method | Path | Request / result | Authorization |
|---|---|---|---|
| POST | `/auth/nostr/challenge` | `{pubkey}` → nonce/expiry | Public |
| POST | `/auth/nostr/login` | `{event}` → JWT/identity | Valid signed nonce |
| POST | `/deals` | Creation object below → Deal | Seller is JWT identity |
| GET | `/deals/{id}` | Deal | Participant |
| GET | `/deals/{id}/agreement` | Complete canonical Agreement | Participant |
| POST | `/deals/{id}/sign` | `{signature:{sig,pubkey}}` → Deal | Buyer/seller; signature identity must match JWT |
| POST | `/deals/{id}/transition` | `{to}` → Deal | Seller ships; buyer accepts; parties cancel unfunded draft/agreed |
| POST | `/deals/{id}/funding/prepare` | No body → Deal | Participant, agreed |
| GET | `/deals/{id}/funding` | FundingInfo with address/scripts/amount/policy | Participant, prepared |
| POST | `/deals/{id}/funding/verify` | No body → Deal | Participant, awaiting_payment |
| POST | `/deals/{id}/settlement/propose` | `{destination_address,fee_sats,purpose}` → Deal | Participant; authorized outcome |
| GET | `/deals/{id}/settlement` | PSBT, valid signature count, phase, txid, confirmations | Participant |
| POST | `/deals/{id}/settlement/sign` | `{signed_psbt}` → Deal | Participant; verified external signatures |
| POST | `/deals/{id}/settlement/finalize` | No body → Deal | Participant; two valid escrow signatures |
| POST | `/deals/{id}/settlement/confirm` | `{}` or `{block_hash}` → Deal | Participant; Core is authoritative |
| GET | `/deals/{id}/events` | Ordered DealEvent array | Participant |
| GET | `/deals/{id}/receipt` | DealReceipt | Participant |
| POST | `/deals/{id}/evidence` | `{kind,content}` → Evidence | Buyer/seller |
| GET | `/deals/{id}/evidence` | Evidence array | Participant |
| POST | `/deals/{id}/disputes` | `{reason}` → Dispute | Buyer/seller, funded/shipped/accepted |
| GET | `/disputes/{id}` | Dispute | Participant in associated deal |
| POST | `/disputes/{id}/resolve` | `{decision,rationale}` → Dispute | This deal's mediator, and configured allowlist if present |
| POST | `/webhooks` | `{url}` → endpoint + owner signing secret | Authenticated owner; HTTPS URL |

Outside `/api/v1`, `GET /health` returns `ok`; `GET /health/ready` queries
PostgreSQL and returns `ready` or HTTP 503. Neither checks Bitcoin. Swagger at
`/docs` redirects to `/docs/`. Webhooks are transactionally queued only; this
repository does not yet run a safe delivery worker.

## Creation and agreement signing

```json
{
  "title":"Laptop",
  "description":"Used laptop, charger included",
  "amount_sats":100000,
  "buyer_pubkey":"<buyer-xonly-or-compressed-key>",
  "mediator_pubkey":"<mediator-xonly-or-compressed-key>",
  "delivery_deadline":"2026-12-01T12:00:00Z",
  "acceptance_window_hours":24,
  "seller_payout_address":"<seller-bcrt1-address>",
  "buyer_refund_address":"<buyer-bcrt1-address>",
  "currency":"BTC",
  "network":"regtest",
  "settlement_model":"bitcoin_multisig_2of3"
}
```

Seller comes from the JWT; optional `seller_pubkey` must match it. Network/model
come from server configuration; optional supplied values must match. Identities
are normalized to lowercase x-only keys. All three must be valid, distinct curve
identities. Amount is an integer, 1 through 2,100,000,000,000,000 satoshis. Title
is 1–256 bytes; optional description is at most 10,000 bytes. Deadline must be in
the future; acceptance window is 1–8760 hours. Only BTC is accepted. If mediators
are configured, the selected mediator must be listed.

Both destinations are optional for backward-compatible creation, but settlement
requires the destination for its purpose to be present in the **signed**
agreement. Agreements without it cannot safely be paid to a caller-chosen address;
create and sign a new agreement. Do not fund such legacy drafts.

Fetch `/agreement` before signing. `Agreement::canonical_bytes()` serializes
fields in struct order with compact JSON, excluding absent optional terms.
SHA256 of those bytes is the agreement ID. Never reorder fields or reformat UTC
values. Do not sign the envelope. The agreement includes server-generated
`created_at`. Use a compatible canonicalization helper and verify the hash equals
the returned deal ID before signing. Existing agreements with absent new fields
retain their original serialization; existing malformed keys are now rejected.

Agreement signatures are **compact 64-byte ECDSA hex**, over SHA256(canonical
bytes), and include a compressed public key. This is separate from the Nostr
Schnorr login signature. Both buyer and seller must sign; the mediator cannot
substitute. Duplicate valid signature submissions are idempotent.

Nostr identities are x-only. Escrow construction uses **even-Y compressed keys**
for these identities. A signer with an odd-Y public key must negate its test/user
secret locally (or use equivalent signer functionality) for escrow ECDSA signing;
the server never performs this key operation. Verify the witness-script public
keys in your signer. Never send the secret to the API.

## Buyer and seller workflow

1. Seller authenticates, creates draft; buyer authenticates and fetches terms.
2. Both sign canonical terms. Deal becomes `agreed` only after both signatures.
3. Participant calls funding preparation, then reads `/funding`:

```json
{"message":"funding","success":true,"data":{"address":"<bcrt1-escrow>","script_pubkey_hex":"0020...","witness_script_hex":"5221...53ae","expected_amount_sats":100000,"required_confirmations":1,"network":"regtest","settlement_model":"bitcoin_multisig_2of3"}}
```

4. Buyer funds that address externally. API only observes Core; it never calls a
   wallet funding/signing RPC. Recheck `/funding/verify` until Deal is `funded`.
   Insufficient amount/confirmations leave it `awaiting_payment`. A funding
   outpoint is uniquely assigned to one agreement. Repeated identical participant key sets produce the same deterministic address;
   the API rejects reusing that escrow address for another agreement. At least one
   party must use a fresh per-deal identity/key. This constraint preserves the
   existing escrow script while preventing ambiguous deposit association.
5. Seller posts `{"to":"shipped"}`; buyer posts `{"to":"accepted"}` after
   delivery. Generic transitions cannot mark a deal agreed, funded, or settled.
6. Participant proposes `{"destination_address":"<signed-seller-address>","fee_sats":1000,"purpose":"payout_seller"}`.
   The destination must exactly equal the signed term. Fees must be positive,
   below input amount, below `BITCOIN_MAX_FEE_SATS` (default 10000), and at most
   `BITCOIN_MAX_FEE_BPS` (default 1000 = 10%) of input amount.
7. Fetch `/settlement`. Inspect unsigned input, output, witness UTXO, script,
   network, amount and fee locally. Locally add a partial ECDSA signature using
   BIP143 SegWit v0 P2WSH `SIGHASH_ALL`, witness script, and exact input amount.
8. Submit `{"signed_psbt":"<base64>"}`. Signers may start from the same unsigned
   PSBT; concurrent valid updates are combined. Only participants can relay
   signatures. Server checks signers belong to the script and verifies ECDSA.
   Submit **partial signatures**, not a client-finalized witness. Input metadata
   and unsigned transaction must remain identical; untrusted derivation/output
   metadata is not copied. This API does not support alternate sighash types.
9. GET progress returns, for example:

```json
{"message":"settlement","success":true,"data":{"current_psbt":"<base64>","valid_signatures":2,"required_signatures":2,"phase":"proposed","txid":null,"confirmations":0,"block_hash":null,"purpose":"payout_seller"}}
```

10. POST `/settlement/finalize`. Server rechecks funding, terms, policy and
    signatures, builds `[empty, sig1, sig2, witness_script]` in script key order,
    records a durable txid/transaction intent, then broadcasts. The Deal stays
    `accepted` (or `disputed`); phase becomes `broadcast`. Repeated finalization
    returns the same stored intent and does not send another transaction.
11. Poll `/settlement/confirm` with `{}`. Without Core `txindex`, provide a known
    inclusion `block_hash`; Core verifies inclusion and active-chain membership.
    The hint alone is never proof. Before the configured confirmation threshold,
    status stays nonterminal. Once confirmed, it becomes `settled` or `refunded`.
    Query the endpoint again to reconcile reorgs: loss of confirmation reverts
    status to the pre-broadcast state and keeps the frozen transaction intent.

Proposals are immutable, including before signatures: a repeated identical
proposal returns the same PSBT, while replacement is rejected. Fee bumping and
proposal cancellation need a separately designed protocol and are not supported.

## Disputes and mediator workflow

Buyer/seller may open a dispute from `funded`, `shipped`, or `accepted` before a
settlement proposal is frozen. A mediator cannot open one for them. Submit text
or reference evidence with `{"kind":"text","content":"Item not delivered"}`.
Evidence has SHA256 of exact UTF-8 content, also included in its event. Do not
upload secrets or unnecessary personal data. Kind is 1–64 bytes and content is
1–100,000 bytes; reason/rationale are 1–10,000 bytes. Legacy evidence hashes may
be null; old data is not silently rewritten.

The associated mediator reads the dispute/evidence and posts
`{"decision":"refund","rationale":"Delivery not substantiated"}` (or
`"release"`). Resolution is immutable and leaves deal state `disputed`.
Only its authorized purpose (`refund_buyer` / `payout_seller`) can be proposed,
to the corresponding signed address. Resolution never bypasses two valid escrow
signatures. Buyer+mediator or seller+mediator can sign the authorized outcome;
any two script participants still satisfy Bitcoin's on-chain 2-of-3 rules.

## Statuses, receipts and uncertainty

API lifecycle: `draft → agreed → awaiting_payment → funded → shipped → accepted`.
`funded`, `shipped`, and `accepted` may enter `disputed`. Confirmed payout ends in
`settled`; confirmed dispute refund ends in `refunded`. `cancelled` is supported
only before funding preparation. `expired` remains a core status; no expiry job
or acceptance-window auto-release worker is implemented.

Settlement phases are `none`, `proposed`, `broadcasting`, `broadcast`,
`broadcast_unknown`, `broadcast_rejected`, `confirmed`. `broadcasting` is durable intent, not proof of
broadcast. A timeout/rejection/crash can leave `broadcast_unknown` or
`broadcasting`; reconcile the stored txid. The API does not blindly rebroadcast,
replace the proposal, or create a new funding request. Manual recovery must
inspect mempool/chain and the stored transaction before any retry. External
spending of the funding UTXO is rejected; an unavailable outpoint is never treated
as proof of the expected settlement. Definitive invalid-transaction/policy rejection is retained as `broadcast_rejected`;
the intent stays frozen pending manual review. No background confirmation/recovery worker
is included; clients/operators must call confirmation.

GET `/receipt` returns the complete agreement, agreement ID, status, settlement
model, network, both signatures when agreed, event history and transaction IDs.
Use `opendeal_core::DealReceipt::verify()` or the existing `regtest-demo
verify-receipt` helper. It checks canonical ID, signatures, chain ordering,
agreement association, network/model, and event/transaction/status consistency.
A broadcast intent may have a settlement txid while status remains nonterminal.
Terminal settlement requires a confirmation event. Reorg events invalidate prior
confirmation claims.

Hash-linked server events are unsigned observations: local receipt verification
establishes internal consistency and signed agreement consent, **not independent
proof that a transaction is currently confirmed**. Verify transactions/scripts
and active-chain confirmations against your own node. An unsigned event history
can be wholly rewritten by a malicious server; no external event-root anchor is
implemented. Historical events with bad timestamps or agreement signatures
incorrectly attached as event signatures are not rewritten and may fail stricter
verification; investigate affected development data explicitly.

## Local commands and tests

From the repository root, edit your existing `.env` locally; do not overwrite or
commit it. See `docs/regtest-backend.md` for credentials. The application does not
automatically load dotenv files:

```bash
set -a
source .env
set +a
cargo run -p opendeal-api
```

Review migration `20261022000002_backend_lifecycle.sql` before setting
`RUN_MIGRATIONS=true`. It adds settlement columns, evidence hashes and uniqueness
indexes; it deletes no data. Existing duplicate escrow addresses, funding assignments or open
disputes will cause index creation to fail and need explicit reconciliation.
Both database URLs must point at the same database with suitable role grants.
Do not run integration tests against production records.

```bash
cargo fmt --all --check
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# Role needs CREATEDB; each run creates and removes its own opendeal_test_<uuid>.
export OPENDEAL_TEST_ADMIN_URL="$DATABASE_ADMIN_URL"
cargo test -p opendeal-api tests::database_http_workflow \
  -- --ignored --exact --nocapture
```

The database suite uses a mock RPC and Axum's HTTP request service. It exercises
real Nostr/JWT login, authorization, payout/refund workflows, funding thresholds,
concurrent signature submissions, PSBT tampering, confirmation/reorg handling,
evidence and independently verified receipts. It does not touch Polar.

The live API test starts an actual loopback HTTP listener with its own disposable
database. It uses the configured Polar wallet and fresh locally held signers.
It funds 100,000 sats, charges 1,000 sats settlement fee, mines blocks and verifies
Core's resulting transaction and the API receipt. The read-only audit found the existing loaded `miner` wallet. Only run after explicit approval:

```bash
export OPENDEAL_TEST_ADMIN_URL="$DATABASE_ADMIN_URL"
export BITCOIN_RPC_WALLET=miner
OPENDEAL_LIVE_API_REGTEST=1 \
BITCOIN_NETWORK=regtest \
BITCOIN_RPC_URL=http://127.0.0.1:18445 \
cargo test -p opendeal-api tests::live_api::live_api_regtest \
  -- --ignored --exact --nocapture
```

It may mine 101 bootstrap blocks if wallet funds are insufficient, and prints
funding outpoint, settlement txid, fees and confirmations. A post-funding failure
prints recovery implications and is never automatically rerun. Keys are
in-memory only: an unspent test escrow may be unrecoverable after process exit.
It does not modify Polar configuration/containers or production database records.
Normal workspace tests leave both live library and API funding tests ignored.

Only the Bitcoin multisig lifecycle is implemented. Lightning, fiat and simulated
adapter seams remain in the workspace; new API deals using those models are
rejected instead of presenting stub payment results as real settlement.


## Recorded API demonstration result

The explicitly approved live HTTP test passed once against the existing `miner`
wallet. It used a fresh disposable PostgreSQL database, which was cleaned up.

- Funding: `fa895503131b7c6a7703eef9b7d416fef7876d79d251e8d607dc1af226b8486e:1`, 100,000 sats, fee 330 sats.
- Settlement: `5d386f017750f82a231f174ba32317dd7ab0dd2031d3bf09ec7a6ddac71b5919`, payout 99,000 sats, fee 1,000 sats.
- Funding and settlement had one confirmation at their respective checks.
- The API returned `settled` only after confirmation; independent receipt verification passed.

See [the implementation/validation report](backend-integration-results.md) for
all results, limitations, migration details and the exact modified-file manifest.
