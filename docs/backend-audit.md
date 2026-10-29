# Initial backend audit (before this implementation)

The library regtest funding and settlement success and txids in the task are
user-reported evidence. This session has not independently rerun that lifecycle.
Prior session checks passed Rust compilation, linting, 15 offline tests and HTTP
health/DB readiness. Those checks did not establish API lifecycle correctness.

Implemented: canonical agreement hashing, ECDSA verification, state-transition
rules, hash linkage, deterministic sorted-key P2WSH escrow, funding scan/script
checks, PSBT construction/combination, authenticated broadcasting, Nostr nonce
login/JWT extraction, PostgreSQL persistence, basic evidence/dispute routes.

Partial: participant authorization is present on some writes but absent from
private reads; agreement acceptance counts mediator signatures; state transition
routes bypass workflow proofs; funding/proposal operations are not status-safe.
The PSBT builder now validates destination network, but API settlement updates do
not verify signatures, immutable terms, or finalize witnesses. Receipts verify
some cryptography but do not bind final status or chain metadata. Agreement
signatures are incorrectly used as event signatures. Nanosecond event timestamps
can change when round-tripped through PostgreSQL's microsecond precision.

Missing: description and signed destination terms, fee policy, signing progress,
confirmation/reorg reconciliation, durable broadcast intent, serialized mutations,
atomic event/state writes, comprehensive OpenAPI/frontend contract, HTTP/database
lifecycle tests and an opt-in API regtest demonstration.

Security: unauthenticated deal/evidence/dispute reads; generic status escalation;
mediators can resolve unrelated deals; resolutions claim terminal payment states
without Bitcoin settlement; unverified PSBT metadata/final witnesses; replayable
writes and concurrent broadcast risks; floating point RPC amount conversion;
production wildcard CORS fallback; unbounded nonce store; synchronous webhook
requests enable SSRF and block lifecycle responses. Idempotency keys hash only the
route, are not scoped to an actor and do not actually replay responses.

Schema: initial migration matches current row types but lacks durable settlement
phase/proposal/confirmation metadata and evidence hashes. Existing migration must
remain unchanged. Additive migrations are required; do not apply to the user's
application database automatically.

Coverage initially comprises core agreement/state/chain/signature tests, mock
funding test, RPC HTTP tests, offline multisig signing tests, a read-only optional
connectivity test and an ignored live library regtest test. No authenticated
HTTP/database lifecycle, authorization matrix, dispute, concurrency, confirmation,
reorg, or API-driven live lifecycle tests existed.
