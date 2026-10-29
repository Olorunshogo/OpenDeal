# Compliance notes for custodial rails

Status: assessment checklist, not a legal opinion and not a license to hold customer money.

Use this only if `SETTLEMENT_MODEL` is `lightning_provider` or `fiat_provider`. Multisig deals do not put customer keys on the OpenDeal server, but the operator still runs infrastructure and stores agreements, evidence, and pubkeys.

## Before offering a custodial rail

- Name the legal entity that contracts with the invoice provider
- Record whether OpenDeal ever holds fiat or bitcoin balances (the HTTP adapter in [`rails.md`](./rails.md) assumes the provider does)
- Confirm the provider’s KYB/KYC duties and what OpenDeal must collect versus what the provider collects
- Decide which countries are in scope and which are refused
- Write a retention period for evidence objects and deal rows
- Publish the custody label in the checkout UI (already required by the product)
- Keep multisig copy off any screen that is actually a provider payment

## Not in this repository

- A payments license
- Sanctions screening
- Automated tax reporting

Those stay with the operator and counsel. Provider redundancy and dispute timing are in [`deploy.md`](./deploy.md) and [`mediator-policy.md`](./mediator-policy.md).
