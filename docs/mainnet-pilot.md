# Constrained mainnet pilot

Status: ops gates only. Do not point this at real user funds until an external review report exists and the operator has set the ack flag themselves.

## What “constrained” means

- Known counterparties only (`OPENDEAL_ALLOWED_PUBKEYS`)
- Known mediators only (`MEDIATOR_PUBKEYS`)
- Amount cap at or below 100_000 sats
- At least 3 confirmations
- Production environment (dev session mint is off)
- Explicit mainnet opt-in plus a security-review acknowledgement

The acknowledgement is an operator statement that a review of `opendeal-bitcoin` happened. This repository does not contain that review.

## Required configuration

```bash
APP_ENV=production
BITCOIN_NETWORK=bitcoin
BITCOIN_RPC_URL=http://user:pass@127.0.0.1:8332
BITCOIN_RPC_URL_FALLBACK=http://user:pass@backup:8332
BITCOIN_REQUIRED_CONFIRMATIONS=3
OPENDEAL_ALLOW_MAINNET=1
OPENDEAL_SECURITY_REVIEW_ACK=1
PILOT_MAX_AMOUNT_SATS=50000
MEDIATOR_PUBKEYS=<hex>,<hex>
OPENDEAL_ALLOWED_PUBKEYS=<seller>,<buyer>,<mediator>
SETTLEMENT_MODEL=bitcoin_multisig_2of3
```

Startup refuses mainnet when any of those gates is missing. `PILOT_MAX_AMOUNT_SATS=0` (unlimited) is refused on mainnet.

Frontend: `NEXT_PUBLIC_BITCOIN_NETWORK=bitcoin` so the deal and checkout screens show the real-funds banner.

## First deal

Follow [`testnet-pilot.md`](./testnet-pilot.md) with mainnet coins you can afford to lose, the cap above, and the PSBT review panel before any signature. Recovery stays manual: [`recovery.md`](./recovery.md).

## Still required before broader funds

- Attach the external review report and clear critical findings ([`security-review.md`](./security-review.md))
- Raise confirmations and keep the allowlist until that review says otherwise
