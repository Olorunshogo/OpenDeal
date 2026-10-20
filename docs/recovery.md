# Timeout and recovery (multisig)

Status: Phase 2 design. Document-first manual recovery is the pilot default. On-chain timelocks are a planned script upgrade, not required to start testnet with known counterparties.

## Decision for the pilot

| Path | Pilot choice |
| --- | --- |
| Documented manual recovery | **Default.** Parties + mediator coordinate an off-server 2-of-3 PSBT. |
| CSV/CLTV timelock in the escrow script | **Deferred** until designed, tested on regtest/testnet, and covered by security review. |

Rationale: changing the escrow script mid-pilot invalidates existing addresses and widens the review surface. Manual recovery is honest, operable with a mediator runbook, and matches the current P2WSH 2-of-3 build.

## What “stuck” means

Funds are stuck when a confirmed escrow UTXO exists and no valid 2-of-3 settlement has been broadcast, typically because:

- Buyer and seller disagree and will not co-sign a payout
- One party disappears after funding
- Mediator has decided, but the second signature is still missing
- Soft timeout (`delivery_deadline` or acceptance window) elapsed without a clean settle

Protocol timeouts (`expired`, dispute windows) update **coordination state**. They do not move Bitcoin by themselves.

## Manual recovery procedure

Prerequisites: deal is `funded` or later with a known `funding_txid` / `vout` / amount; escrow descriptor (witness script) available from the API or receipt; at least two of {buyer, seller, mediator} can sign.

1. Confirm on-chain UTXO still exists (bitcoind / explorer) and matches the deal amount and script.
2. Agree the outcome off-band or via mediator decision: **payout seller** or **refund buyer**.
3. Choose a destination address controlled by the receiving party.
4. Call `POST /api/v1/deals/{id}/settlement/propose` with `purpose` `payout_seller` or `refund_buyer`, a policy-valid `fee_sats`, and the destination.
5. Review the PSBT offline (amounts, fee, outputs). Do not sign if anything is unexpected.
6. Two parties sign the PSBT **off-server** (local wallets / `sign_psbt_with_secret` in tools). Attach via `settlement/sign`.
7. `settlement/finalize` broadcasts when the combined PSBT is complete.
8. Export and archive the receipt (`GET .../receipt`). Verify offline with `regtest-demo verify-receipt`.

If the API is unavailable, build/combine/broadcast the same 2-of-3 spend with `opendeal-bitcoin` helpers and bitcoind. The receipt may need to be reconstructed from local event logs afterward.

## Soft timeouts (coordination only)

| Clock | Meaning | Bitcoin effect |
| --- | --- | --- |
| `delivery_deadline` | Seller should ship by this time | None by itself |
| `acceptance_window_hours` | Buyer should accept or dispute after ship | None by itself |
| Deal status `expired` | Coordination gives up on the happy path | Still needs a recovery PSBT if funded |

Support should treat a funded + timed-out deal as **manual recovery**, not “auto refund.”

## Future: timelock recovery (not in pilot script)

When implemented, the escrow script would add a delayed unilateral path (for example CSV after relative blocks, or CLTV to an absolute height) so one designated party can reclaim after timeout without the other. Requirements before enabling on testnet/mainnet:

- Spec in this file and `protocol.md` (who can claim, after what delay)
- Regtest vectors and negative tests in `opendeal-bitcoin`
- PSBT review UX shows the timelock path clearly
- External review of the script change

Until then, do not advertise unilateral recovery.

## Residual risk (accepted for pilot)

If all three key holders refuse to sign, funds remain locked. Mitigate with known counterparties, mediator SLAs, and caps on pilot amounts.
