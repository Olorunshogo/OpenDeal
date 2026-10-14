# OpenDeal Protocol

OpenDeal coordinates peer-to-peer commerce. It is not a marketplace and not a custodian.

## Core objects

### Agreement

Versioned, machine-readable deal terms. Canonical JSON bytes are hashed (SHA-256) to produce the deal id. Buyer and seller must sign the exact same bytes.

Fields include title, `amount_sats`, party pubkeys (seller/buyer/mediator), delivery deadline, acceptance window, `settlement_model`, and `network`.

### Deal status

```
draft -> agreed -> awaiting_payment -> funded -> shipped -> accepted -> settled
```

Side exits: `cancelled`, `disputed`, `refunded`, `expired`.

Illegal transitions are rejected by `opendeal-core` and enforced again in the API before any database write.

### Events

Append-only, hash-chained records. Each event includes `prev_event_hash` (empty for genesis), `sequence`, payload, actor pubkey, and optional signature. Receipts can be verified offline without trusting the API.

### Settlement models

| Model | Meaning |
| --- | --- |
| `bitcoin_multisig_2of3` | P2WSH 2-of-3. The API never holds spending keys. |
| `lightning_provider` | Provider-mediated Lightning. Custody depends on the provider. |
| `fiat_provider` | Fiat rail. Custodial relative to OpenDeal. |
| `simulated` | Dev/demo only. Refused in production. |

## Settlement flow (multisig)

1. `prepare_funding`: derive a deterministic 2-of-3 address from party pubkeys
2. Buyer funds the address externally
3. `verify_funding`: script match, amount, and confirmations (not merely “tx seen”)
4. `propose_settlement`: unsigned PSBT (payout or refund)
5. Parties attach signatures externally. The API combines PSBT updates.
6. `finalize_and_broadcast`: extract and broadcast when 2-of-3 is complete

A mediator decision updates protocol state and recommended payout. It does **not** move Bitcoin by itself.

## Receipts

`GET /api/v1/deals/{id}/receipt` returns a portable JSON receipt. Verify with `opendeal-core` or:

```bash
cargo run -p regtest-demo -- verify-receipt path/to/receipt.json
```
