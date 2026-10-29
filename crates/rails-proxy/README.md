# rails-proxy

Sandbox implementation of the HTTP invoice contract in [`../../docs/rails.md`](../../docs/rails.md).
Lets `opendeal-api`'s Lightning/fiat settlement adapters exercise a real HTTP round trip without
a Lightning node or a fiat provider account. **No real money moves through this binary.**

```bash
RAILS_PROXY_TOKEN=change-me PORT=8081 cargo run -p rails-proxy
```

Point the API at it:

```bash
LIGHTNING_API_URL=http://127.0.0.1:8081
LIGHTNING_API_KEY=change-me
# or FIAT_API_URL / FIAT_API_KEY, same shape
```

## Routes

| Route | Matches `docs/rails.md` |
| --- | --- |
| `POST /invoices` | `{ reference, amount_sats }` → `{ checkout_reference, label? }` |
| `GET /invoices/{reference}` | → `{ funded, amount_sats?, txid? }` |
| `POST /invoices/{reference}/release` | 2xx |
| `POST /invoices/{reference}/refund` | 2xx |
| `POST /sandbox/invoices/{reference}/fund` | **sandbox-only** — flips `funded` so you can test the status-polling path without a real webhook. Delete this route when you wire a real provider. |

All routes require `Authorization: Bearer $RAILS_PROXY_TOKEN`.

## Going live

This binary is a seam, not a provider. To use a real rail, replace the bodies of
`create_invoice` / `invoice_status` / `release` / `refund` in `src/main.rs` with calls to that
provider's API (Bitnob, MavaPay, an NWC wallet, Paystack, Flutterwave), keeping the same
request/response shapes — the `opendeal-api` side needs no changes. Before any of that touches
real money: read [`../../docs/compliance.md`](../../docs/compliance.md) and get counsel's sign-off.
