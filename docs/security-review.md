# Security review prep (`opendeal-bitcoin`)

Status: Phase 2 packaging for an external review. This is not the review itself.

## Scope (in)

Primary crate: [`crates/opendeal-bitcoin`](../crates/opendeal-bitcoin)

| Module | Responsibility |
| --- | --- |
| `escrow` | Sorted 2-of-3 P2WSH witness script, address derivation |
| `policy` | Fee / dust / min-deal amount gates |
| `psbt` | Unsigned settlement PSBT build, combine, finalize, extract |
| `settlement` | Funding prepare/verify orchestration, propose/attach/broadcast |
| `rpc` | Bitcoin Core JSON-RPC client (no wallet-key RPCs) |

Related but secondary (call out if the reviewer has bandwidth):

- API wiring of settlement in `opendeal-api` (no keys stored)
- Pilot caps / mainnet gate (`PILOT_MAX_AMOUNT_SATS`, `OPENDEAL_ALLOW_MAINNET`)
- Frontend PSBT review UX (display only; local sign is optional demo)

## Scope (out)

- Physical delivery disputes, mediator honesty, social engineering
- Lightning/fiat adapters
- Timelock recovery script (deferred; see [`recovery.md`](./recovery.md))
- Full API auth, webhooks, storage (threat model only)

## Guarantees the product claims

1. The API never holds party private keys or seed phrases.
2. Escrow spends require **2-of-3** signatures on a single-input P2WSH settlement.
3. Funding is accepted only when script pubkey matches and confirmations meet the configured threshold.
4. Settlement amounts obey `FeeDustPolicy` (min fee, max fee, max fee bps, dust floor).
5. Destination addresses must match the deal network.
6. Buyer, seller, and mediator pubkeys must be three distinct compressed keys.

## Reviewer checklist

### Escrow script

- [ ] Witness script is exactly `OP_2 <pk1> <pk2> <pk3> OP_3 OP_CHECKMULTISIG` with **lexicographically sorted** compressed pubkeys
- [ ] Address / `script_pubkey` is P2WSH of that witness script on the intended network
- [ ] Duplicate or uncompressed keys are rejected
- [ ] X-only (32-byte) pubkey path (`02 || x` even-y assumption) is documented and acceptable for the pilot, or should be removed

### Funding verification

- [ ] UTXO acceptance requires script match + amount ≥ expected + confirmations ≥ N
- [ ] Overpayment to the correct script is intentional; underpayment fails
- [ ] RPC path does not call `dumpprivkey`, `walletpassphrase`, or similar
- [ ] `scantxoutset` / UTXO discovery assumptions are acceptable for the pilot deployment

### PSBT lifecycle

- [ ] Built PSBT is single-input, single-output, `SIGHASH_ALL`, RBF-enabled sequence
- [ ] Output amount = funding − fee with policy checks
- [ ] Destination `require_network` matches escrow network
- [ ] `combine` refuses mismatched unsigned txids
- [ ] Finalize requires ≥2 partial sigs in script order and rejects non-`SIGHASH_ALL`
- [ ] One signature alone cannot finalize or broadcast
- [ ] `sign_psbt_with_secret` is a **local/tooling helper** only; production parties should sign in their wallets

### Policy and ops gates

- [ ] `FeeDustPolicy` constants match intended pilot economics
- [ ] `PILOT_MAX_AMOUNT_SATS` defaults are sane for testnet/mainnet
- [ ] Mainnet refuses without `OPENDEAL_ALLOW_MAINNET=1`
- [ ] Manual recovery residual risk is accepted ([`recovery.md`](./recovery.md))

### Suggested test commands

```bash
cargo test -p opendeal-bitcoin
cargo test -p opendeal-core
# optional live path (regtest): make up && make api && make e2e
```

## Known residual risks (explicit)

| Risk | Notes |
| --- | --- |
| Mediator + one party | Can settle against the third; inherent to 2-of-3 |
| Triple non-cooperation | Funds stay locked until two keys sign; no timelock in pilot script |
| X-only even-y mapping | 64-hex keys assume even Y; wrong parity yields a different key |
| Funding overpay | Extra sats to the escrow script are spendable in the same 2-of-3 |
| RPC trust | Compromised `bitcoind` can lie about confirmations or censor broadcast |
| Combine trust | API combines PSBT updates; parties must review before signing |

## Artifacts to give the reviewer

1. This document
2. [`threat-model.md`](./threat-model.md)
3. [`protocol.md`](./protocol.md), [`recovery.md`](./recovery.md), [`mediator-policy.md`](./mediator-policy.md)
4. [`testnet-pilot.md`](./testnet-pilot.md)
5. Git tag or commit SHA under review
6. `cargo test -p opendeal-bitcoin` output

## After the review

- Track findings in the issue tracker; block mainnet on critical/high items
- Update [`roadmap.md`](./roadmap.md) when an external review is completed (replace “prep” with date + report link)
- Only then proceed with constrained mainnet ([`deploy.md`](./deploy.md) gates)

## Hardening landed with this prep

- Distinct buyer/seller/mediator keys required
- Compressed-only pubkey parsing (plus documented x-only → `02||x`)
- Settlement destination must match escrow network
- Escrow `script_pubkey` must hash-match `witness_script` at PSBT build
- PSBT combine checks unsigned txid identity and single-input shape
- Finalize requires `SIGHASH_ALL` on collected sigs
- Unit coverage for duplicate keys, wrong-network destination, 2-of-3 finalize roundtrip
