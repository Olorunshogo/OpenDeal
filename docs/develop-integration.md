# Develop branch integration

The backend integration was replayed as ten commits onto the existing develop branch. Existing storage uploads, rate limiting, telemetry, metadata, reputation, development login, dispute listing, mail hooks, and webhook retry support were retained. The hardened lifecycle requires Bitcoin settlement. Webhook delivery is disabled unless WEBHOOK_DELIVERY_ENABLED=true; WEBHOOK_ALLOWED_HOSTS must explicitly allow the HTTPS destination host.

The OpenAPI contract includes 30 operations, including the five additional develop operations. Agreement retrieval retains the nested agreement, canonical_hex, and signed_pubkeys fields used by the existing frontend, alongside the direct agreement fields.

The live Bitcoin results in backend-integration-results.md describe the previously authorized successful run before this branch reconciliation. No second live funding or settlement run was performed during the branch move.

Validation during reconciliation: `cargo fmt --all --check`, `git diff --check`, and `cargo check --workspace --all-targets` passed. Strict workspace Clippy reported existing `rails-proxy` warnings (`needless_return` and `result_large_err`); those unrelated handlers were preserved.

The legacy settlement adapter retains configured fallback RPC support. The hardened lifecycle's separate chain-observation client currently uses the primary endpoint; fallback observation/broadcast is not promised for that path.

`cargo test --workspace` passed after reusing the already downloaded Swagger UI archive (the first test build could not reach GitHub). The harness reported 33 passing tests and three ignored tests. Of those passing tests, the credential-gated RPC connectivity test returned early without a live connection; 32 tests exercised offline behavior. Disposable PostgreSQL and both transaction-broadcasting regtest tests were not rerun. A separate backend Clippy run also identified a pre-existing `collapsible_if` warning in `mail.rs`; strict Clippy therefore remains failing on develop.
