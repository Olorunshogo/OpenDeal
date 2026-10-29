# OpenDeal TUI: demo preparation

`opendeal-tui` is a terminal tool for getting the data for an OpenDeal demo ready. It collects participant public keys, previews the 2-of-3 escrow address, and validates the deal terms. It then hands everything to the browser as a versioned JSON file or via the clipboard.

The Next.js frontend is still the main interface. You create, sign, fund and settle deals there. The TUI is optional, and the web app works without it.

## What it does and does not do

| Does | Does not |
| --- | --- |
| Show API, database, network and mediator-registry status | Hold, generate, decrypt or ask for private keys or passphrases |
| Read **public keys** from the browser's encrypted recovery file | Sign in, hold a JWT, or call authenticated endpoints |
| Let you pick an approved mediator from `GET /api/v1/mediators` | Register or approve mediators (that needs the mediator's signature, in the browser) |
| Derive and verify the escrow address with `opendeal-bitcoin` | Fund, mine, broadcast or settle anything |
| Validate deal terms against the API's `create_deal` rules | Create deals (the signed-in seller does that in the browser) |
| Export a versioned JSON file and copy values to the clipboard | Change `.env`, the database or migrations |

### Why the TUI holds no keys

In OpenDeal, each participant creates a secp256k1 identity in the browser at `/onboarding`. It is saved in an encrypted recovery file (and optionally an encrypted copy on that device), and the participant signs in by signing a Nostr challenge. Creating a deal needs the seller's session.

Giving the TUI that power would mean decrypting keys in a second place, or using the dev-only `/auth/dev/session` route. That route issues a token for any public key without proof, so it is off unless `OPENDEAL_DEV_SESSION_ENABLED=true` and is never used by the browser. The TUI does neither. It prepares public data, and the browser keeps every step that needs a signature. See [Security decisions to review](#security-decisions-to-review).

## Where each piece of logic lives

| Concern | Authoritative code | How the TUI uses it |
| --- | --- | --- |
| Key format and normalization | `opendeal_core::verification::normalize_identity` | Called directly |
| Escrow script and address | `opendeal_bitcoin::EscrowKeys::build_escrow` | Called directly with the same x-only keys the API stores, then independently re-checked (P2WSH hash, 2-of-3 script shape, network) |
| Minimum amount | `opendeal_bitcoin::FeeDustPolicy` | Called directly |
| Deal field rules | `opendeal-api` `deals::service::create_deal` | Mirrored for early feedback; the API checks again on create |
| Network, pilot cap, mediators | `GET /api/v1/meta`, `GET /api/v1/mediators` | Read over HTTP without credentials |

The escrow address the TUI shows is the address the API records at `POST /deals/{id}/funding/prepare`, once both parties have signed. A shared test vector checks that the Rust and browser implementations agree. During development the address was also checked against Bitcoin Core with `decodescript`.

## Running

Prerequisites are the normal stack (see the [README](../README.md)):

```bash
make up          # Postgres + bitcoind
make api         # terminal 1
make frontend    # terminal 2
make tui         # terminal 3
```

Options (pass them with `make tui ARGS="..."`, or run `cargo run -p opendeal-tui -- --help`):

| Option | Env | Default |
| --- | --- | --- |
| `--api-url` | `OPENDEAL_API_URL` | `http://localhost:8080` |
| `--frontend-url` | `OPENDEAL_FRONTEND_URL` | `http://localhost:3000` |
| `--seller-file <path>` | | Seller's recovery file from `/onboarding`. Only the public key is read. |
| `--buyer-file <path>` | | Buyer's recovery file |
| `--mediator-file <path>` | | Mediator's recovery file. It is selected only if the mediator is approved. |
| `--recovery <path>` | | Any file to load at start: identity file, earlier three-participant workspace file, or a prepared configuration |
| `--export <path>` | | `data/prepared/opendeal-prepared-deal.json` (git-ignored) |
| `--network <name>` | | none. Used only while the API is offline. The API's `/meta` always takes priority. |

The TUI does not read any `.env` file and needs no secrets.

## Workflow

1. **Create identities in the browser.** Each participant opens `http://localhost:3000/onboarding` and clicks **Create identity**. That downloads `opendeal-identity-xxxxxxxx.json`. See [demo.md](./demo.md) Part 1.
2. **Approve the mediator in the browser.** The mediator applies on `/mediator` and an administrator approves it ([demo.md](./demo.md) Part 1b). This needs the mediator's signature, so it cannot happen in the TUI.
3. **Start the TUI** with the participants' files:

   ```bash
   make tui ARGS="--seller-file ~/Downloads/opendeal-identity-aaaa.json --buyer-file ~/Downloads/opendeal-identity-bbbb.json --mediator-file ~/Downloads/opendeal-identity-cccc.json"
   ```

   Or open **Load browser identities**, load each file, and press `s`, `b` or `m` to assign its role. Pasting public keys on the Seller and Buyer screens also works.
   - Only public keys are read. The encrypted envelopes are never read.
   - An approved mediator is selected automatically. If it is not approved yet, press `r` after approval.
4. **Check the mediator** under **Mediator (registry)**. Use ↑/↓ and Enter to choose another approved mediator. Entries marked `[configuration]` come from `MEDIATOR_PUBKEYS`, so choose one only if you control its key.
5. **Check the public keys** under **Public keys**. Each participant has two forms:
   - *Identity (x-only)*: 64 hex characters. This is what the API stores and what the browser contact fields accept.
   - *Escrow key (compressed)*: `02` followed by the x-only key. This is what appears in the witness script.

   Press `y` to copy one.
6. **Derive the escrow** under **Escrow address** by pressing `d`. The screen shows the network, the script type, the participants, the address, the witness script and the scriptPubKey. It also says **DERIVED ONLY: not funded**.
7. **Fill in the deal terms** under **Deal terms**. Fields match `POST /api/v1/deals`:
   - title
   - optional description
   - amount in sats (at least 10,000, and no more than the server's pilot cap)
   - delivery deadline (`3d`, `72h`, or RFC 3339)
   - acceptance window in hours
   - seller payout address and buyer refund address

   Both addresses must be valid on the API's network. They come from the seller's and buyer's own wallets; on regtest, `bitcoin-cli -regtest getnewaddress` works.
8. **Export** under **Export configuration** by pressing `e`. The file is written owner-only (0600) and is never overwritten silently: you are asked to press `o` first. Press `c` to copy the JSON instead.
9. **Import in the browser.**
   - Sign in as the **seller** on `/onboarding` (the API creates the deal as the signed-in seller).
   - Open `/deals/new`, expand **Import prepared configuration**, and choose the file (or paste the JSON and click **Preview pasted JSON**).
   - Check the preview and its checks: escrow re-derived in the browser, seller matches the session, mediator approved.
   - Click **Apply to form**, review the form, then click **Create deal**.
10. **Optionally record the deal ID** in the TUI under **Deal ID & links**: paste it, press `y` to copy it, or `o` to open the deal page. Everything after this (signing, funding, settlement, disputes, receipts) continues on the deal page as described in [demo.md](./demo.md).

## Keys

| Where | Keys |
| --- | --- |
| Anywhere | `Ctrl+C` quits |
| Menu | ↑/↓ or `j`/`k` move, Enter opens, `r` refreshes status, `q` quits |
| Screens | Esc/Tab returns to the menu, ↑/↓ selects, `y` copies, `r` refreshes |
| Input fields | Enter starts editing; Enter saves, Esc cancels, Ctrl+U clears. Pasting into a selected field saves it straight away |
| Escrow | `d` derives |
| Export | `e` exports, `c` copies the JSON, `o` confirms an overwrite |
| Deal ID | `u` copies the deal URL, `o` opens it, `x` clears |
| Frontend | `o` opens the selected URL in your browser |

If the system clipboard is not available (headless or SSH session), a popup shows the value so you can select and copy it by hand.

## Prepared configuration format (schema v1)

```json
{
  "schema_version": 1,
  "kind": "opendeal.prepared_deal",
  "generated_at": "2026-10-28T22:16:26Z",
  "generator": "opendeal-tui 0.1.0",
  "network": "regtest",
  "settlement_model": "bitcoin_multisig_2of3",
  "deal": {
    "title": "Used laptop",
    "description": "optional",
    "amount_sats": 50000,
    "currency": "BTC",
    "delivery_deadline": "2026-10-31T22:16:26Z",
    "acceptance_window_hours": 48,
    "seller_payout_address": "bcrt1q…",
    "buyer_refund_address": "bcrt1q…"
  },
  "participants": {
    "seller_pubkey": "<64-hex x-only>",
    "buyer_pubkey": "<64-hex x-only>",
    "mediator_pubkey": "<64-hex x-only>",
    "mediator_display_name": "optional"
  },
  "escrow_preview": {
    "address": "bcrt1q…",
    "script_type": "p2wsh_multisig_2of3_sorted",
    "witness_script_hex": "5221…53ae",
    "script_pubkey_hex": "0020…",
    "sorted_pubkeys": ["02…", "02…", "02…"]
  }
}
```

Rules, enforced by both the TUI (`crates/opendeal-tui/src/prepared.rs`) and the frontend (`frontend/src/lib/prepared-deal.ts`):

- `schema_version` must be `1`. Other versions are rejected with a clear message.
- Unknown fields at any level are rejected, so a file cannot carry keys or tokens.
- The file can be at most 16 KiB.
- `network` must equal the API's network. Mainnet is refused.
- Public keys must be lowercase x-only, valid curve points, and distinct.
- The escrow preview is re-derived and must match exactly.
- Amounts, deadline, acceptance window and addresses follow the API's `create_deal` limits.

The file contains no private keys, seeds, passphrases, recovery envelopes, JWTs, cookies, RPC credentials or API secrets.

When applied, the browser sends the normal create request. It also includes `seller_pubkey`, `network` and `settlement_model`, so the API refuses the deal if the signed-in seller or the server configuration differs. The escrow preview is never sent; the API derives the escrow itself after both parties sign.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `API ● offline` | Run `make api` and check `--api-url`. Press `r` to retry. |
| `DB ● unavailable` | Run `make up` and check `DATABASE_URL` and the Postgres port (default 5435). |
| `NETWORK UNKNOWN` | The API is offline. Start it, or pass `--network regtest` to work offline. Exports always use the API's network once it is online. |
| "Mediator … is not approved" | The mediator applies on `/mediator`, an administrator approves it, then press `r`. |
| "No approved mediators" | Approve one in the administrator review queue on `/mediator`, or set `MEDIATOR_PUBKEYS`. |
| Key rejected | Paste 64 hex characters (x-only) or 66 (`02`/`03` compressed). `npub`, `0x…` and uncompressed keys are refused. Anything that looks like a private key is discarded without being echoed. |
| Address "not valid on regtest" | Use a `bcrt1…` address from the regtest wallet. |
| Browser import: "Seller is the signed-in identity" ⚠ | Sign in as the prepared seller on `/onboarding` before you click Create deal. |
| Browser import: deadline has passed | Export again from the TUI. Relative deadlines are fixed at export time. |
| Clipboard popup appears | No clipboard is available, so copy the shown value by hand. |
| Terminal looks broken after a crash | Run `reset`. The TUI restores the terminal on exit and on panic, but a `kill -9` cannot be caught. |

## Tests

```bash
make test-tui                       # unit tests: keys, escrow, schema, export, API errors, clipboard fallback, navigation
cd frontend && pnpm test            # includes tests/prepared-deal.test.mjs
OPENDEAL_TUI_LIVE=1 cargo test -p opendeal-tui --test live_api -- --nocapture   # opt-in, needs the running API
```

The live test reads public endpoints, uses random public keys and an approved registry mediator, and writes only to the system temp directory. It makes no authenticated calls and changes nothing in the database.

## Security decisions to review

- **No signing in the TUI.** Creating deals from the terminal would need either decrypting the browser recovery file in Rust (PBKDF2 + AES-GCM, then a Nostr login) or the dev-only `/auth/dev/session` route. Neither is implemented. If terminal deal creation is wanted later, the first option is the one that keeps proof of key possession.
- **Recovery file parsing** declares only public fields, so `salt`, `iv` and `ciphertext` are never deserialized.
- **`[configuration]` mediators** listed by the API come from `MEDIATOR_PUBKEYS`. Whoever runs the demo must hold the matching key for disputes to work.
