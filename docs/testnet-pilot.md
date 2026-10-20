# Testnet pilot runbook

Status: Phase 2 ops readiness. Use with known counterparties only. Not a security audit.

## Goal

Run real Bitcoin testnet deals end to end: dual-signed agreement, fund 2-of-3 P2WSH, review PSBT, two-of-three sign off-server, broadcast. Mainnet stays gated (`OPENDEAL_ALLOW_MAINNET`).

## Prerequisites

- Postgres + API + frontend (see [`deploy.md`](./deploy.md))
- `bitcoind` (or equivalent) on **testnet** with RPC credentials OpenDeal can reach
- Three known pubkeys: seller, buyer, mediator (mediator must be in `MEDIATOR_PUBKEYS` for production)
- Testnet coins from a faucet (enough for deal amount + fees)
- Wallets that can fund a P2WSH address and sign/export PSBTs

## Configuration

```bash
APP_ENV=production          # or development while iterating
BITCOIN_NETWORK=testnet
BITCOIN_RPC_URL=http://user:pass@127.0.0.1:18332
BITCOIN_REQUIRED_CONFIRMATIONS=1
SETTLEMENT_MODEL=bitcoin_multisig_2of3
OPENDEAL_ALLOW_MAINNET=false
MEDIATOR_PUBKEYS=<hex>,<hex>
PILOT_MAX_AMOUNT_SATS=100000
JWT_SECRET=<at least 32 chars>
```

Defaults when `PILOT_MAX_AMOUNT_SATS` is unset:

| Network | Cap |
| --- | --- |
| `regtest` | none (local DX) |
| `testnet` / `signet` | 100_000 sats |
| `bitcoin` / `mainnet` | 50_000 sats |

Set `PILOT_MAX_AMOUNT_SATS=0` to disable the cap (not recommended for pilots).

Frontend: set `NEXT_PUBLIC_BITCOIN_NETWORK=testnet` so create/deal screens show the live-network banner even before a deal loads. Match the API `BITCOIN_NETWORK`.

## First-deal checklist

1. Confirm API `/health` and `/health/ready`, and `GET /api/v1/meta` shows `network: testnet` with the expected pilot cap.
2. Create three identities (Nostr or regtest-style secrets). Put the mediator in `MEDIATOR_PUBKEYS` and restart the API.
3. Seller creates a deal at or below the pilot cap; buyer and seller dual-sign the agreement.
4. Prepare funding; send **exact** amount to the escrow address from a testnet wallet; mine/wait for `BITCOIN_REQUIRED_CONFIRMATIONS`.
5. Verify funding in the UI / `funding/verify`.
6. Happy path: ship → accept → propose settlement (`payout_seller`) with a policy-valid fee → review PSBT on the deal page → two parties sign → finalize.
7. Dispute path (optional): open dispute → mediator resolves → propose refund or payout → same PSBT review.
8. Export receipt; keep txids and the receipt JSON for the pilot log.

## Faucets and explorers

Faucet URLs change often. Prefer a well-known public testnet faucet or an internal faucet your team controls. Verify deposits on a testnet explorer before calling verify funding.

## Recovery and mediation

- Stuck funds: [`recovery.md`](./recovery.md) (manual 2-of-3; no timelock in pilot script)
- Mediator behavior: [`mediator-policy.md`](./mediator-policy.md)
- Threat assumptions: [`threat-model.md`](./threat-model.md)

## What “Done” means for this checklist

Ops-ready means config, caps, docs, and UI warnings are in place so a known trio can complete a testnet deal safely. Logging a successful on-chain testnet settlement is an operator activity, not a CI gate.

## Before mainnet

- External review of `opendeal-bitcoin` (roadmap)
- Explicit `OPENDEAL_ALLOW_MAINNET=1`
- Lower amount caps and known counterparties only
- Raise confirmations and production secrets (see [`deploy.md`](./deploy.md))
