# External review packet — `opendeal-bitcoin`

Assembled per the "Artifacts to give the reviewer" list in
[`../security-review.md`](../security-review.md). This directory holds the packet's test-output
evidence and a fixed index; it does **not** duplicate the docs themselves, so they can't drift out
of sync with the packet — point the reviewer at the commit below and the paths listed here.

## Commit under review

```
<fill in after committing this session's work — HEAD at packaging time was be4feee7538da0e34185c0598afe3d1f42080fb0,
 which does NOT yet include the frontend/theme/env work or the disputes-list endpoint from this session>
```

Re-stamp this line with `git rev-parse HEAD` right before sending the packet, once everything
you want reviewed is committed.

## Scope

Primary crate: [`crates/opendeal-bitcoin`](../../crates/opendeal-bitcoin) — `escrow`, `policy`,
`psbt`, `settlement`, `rpc` modules. Full scope-in / scope-out list and the reviewer checklist are
in [`../security-review.md`](../security-review.md) — read that first.

## Documents to send (by path, at the commit above)

1. [`../security-review.md`](../security-review.md) — scope, guarantees, checklist, residual risks
2. [`../threat-model.md`](../threat-model.md)
3. [`../protocol.md`](../protocol.md)
4. [`../recovery.md`](../recovery.md)
5. [`../mediator-policy.md`](../mediator-policy.md)
6. [`../testnet-pilot.md`](../testnet-pilot.md)

## Test output (captured 2026-10-22, `cargo test -p opendeal-bitcoin`)

```
running 11 tests
test policy::tests::accepts_sane_settlement ... ok
test policy::tests::rejects_dust_output ... ok
test policy::tests::rejects_fee_above_bps_cap ... ok
test policy::tests::rejects_tiny_deal ... ok
test policy::tests::rejects_fee_below_floor ... ok
test escrow::tests::rejects_duplicate_pubkeys ... ok
test rpc::tests::fallback_rpc_used_when_primary_fails ... ok
test settlement::tests::verify_funding_requires_confirmations_and_script ... ok
test escrow::tests::address_is_deterministic ... ok
test psbt::tests::rejects_destination_on_wrong_network ... ok
test psbt::tests::settlement_roundtrip_needs_two_sigs ... ok

test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```

Re-run `cargo test -p opendeal-bitcoin` right before sending and replace this block if anything
changed.

## Before you send it

- [ ] Commit everything you want in scope; fill in the commit SHA above
- [ ] Re-run the test command and paste fresh output
- [ ] Confirm the reviewer has repo access (or a tarball/zip at that commit) — this packet assumes
      they can open the file paths above, it doesn't inline their content
- [ ] Agree scope/cost/timeline with the reviewer before they start

## After the review

Track findings, fix critical/high items in `opendeal-bitcoin` before any mainnet flag, then update
[`../roadmap.md`](../roadmap.md) and set `OPENDEAL_SECURITY_REVIEW_ACK=1` — see "After the review"
in [`../security-review.md`](../security-review.md).
