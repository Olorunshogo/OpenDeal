# Pluggable settlement rails

Multisig is the product default. Lightning and fiat are provider-custody rails. The UI must show that difference (`custody` on `GET /api/v1/meta`, checkout page copy).

## Models

| `SETTLEMENT_MODEL` | Custody | Spend path |
| --- | --- | --- |
| `bitcoin_multisig_2of3` | Parties + mediator keys. API holds none. | PSBT 2-of-3 |
| `lightning_provider` | Invoice provider | HTTP release/refund |
| `fiat_provider` | Invoice provider | HTTP release/refund |
| `simulated` | None | Refused when `APP_ENV=production` |

## Live provider contract

Set both URL and key or the process keeps an in-memory stub (development only). Production refuses Lightning or fiat without credentials.

```bash
LIGHTNING_API_URL=https://invoices.example
LIGHTNING_API_KEY=...
# or
FIAT_API_URL=https://fiat.example
FIAT_API_KEY=...
```

The API expects:

- `POST /invoices` JSON `{ "reference", "amount_sats" }` → `{ "checkout_reference", "label"? }`
- `GET /invoices/{reference}` → `{ "funded": bool, "amount_sats"?, "txid"? }`
- `POST /invoices/{reference}/release` and `/refund` → 2xx

Bearer auth. A 2xx on create does not mean the invoice is paid. Funding follows the status call.

This is an operator adapter, not a built-in Bitnob or Paystack client. Map that provider in a small proxy that speaks the contract above.

[`crates/rails-proxy`](../crates/rails-proxy) is a sandbox implementation of this contract (in-memory, no real funds) — useful for exercising the API's settlement adapters end to end before a real provider is wired in. Swap its handler bodies for a real client when you're ready to go live.

## Checkout and toy market

- `/deals/{id}/checkout` shows amount, network, escrow address, and the custody label
- `/market` is one listing that opens `/deals/new` with the title and amount filled in

## Reputation

`GET /api/v1/deals/reputation/{pubkey}` counts seller/buyer rows plus settled, refunded, and disputed statuses. It is a count of deal rows, not a credit score.
