# OpenDeal Demo Walkthrough

A click-by-click guide to running the full Bitcoin escrow lifecycle on regtest: two parties agree on a deal, fund a 2-of-3 multisig escrow, and settle it with a jointly signed PSBT.

| | |
|---|---|
| **Time** | About 10 minutes |
| **Network** | Bitcoin regtest (local, no real funds) |
| **You need** | Docker, Rust toolchain, pnpm, 3 browser windows |
| **Status flow** | `draft` → `agreed` → `funded` → `shipped` → `accepted` → `settled` |

**Contents**

1. [Start the stack](#start-the-stack)
2. [Set up the regtest wallet](#set-up-the-regtest-wallet)
3. [Part 1: Create identities](#part-1-create-identities)
4. [Part 2: Create and sign the deal](#part-2-create-and-sign-the-deal)
5. [Part 3: Fund the escrow](#part-3-fund-the-escrow)
6. [Part 4: Delivery and settlement](#part-4-delivery-and-settlement)
7. [Part 5: Dispute path (optional)](#part-5-dispute-path-optional)
8. [Fallback: terminal-only lifecycle](#fallback-terminal-only-lifecycle)
9. [Troubleshooting](#troubleshooting)
10. [Shut down](#shut-down)

---

## Start the stack

Run everything from the repository root.

**1. Postgres and bitcoind**

```bash
make up
```

Expect both `opendeal-postgres-1` and `opendeal-bitcoind-1` to start, then `Postgres host port: 127.0.0.1:5435`.

**2. API** (terminal A)

```bash
make api
```

Wait until it reports listening on `:8080`. Migrations run on boot.

**3. Frontend** (terminal B)

```bash
make frontend
```

Open <http://localhost:3000>.

| Service | URL |
|---|---|
| Frontend | <http://localhost:3000> |
| API | <http://localhost:8080> |
| OpenAPI UI | <http://localhost:8080/docs> |

> [!TIP]
> The header shows a status dot: green **API online**, amber **API degraded** (database down), red **API offline**. A banner appears above the page whenever the API is not fully available, and it clears itself when the API recovers.

---

## Set up the regtest wallet

Use terminal C, from the repository root.

**1. Define the `btc` helper**

```bash
unalias btc 2>/dev/null
btc() { docker compose exec -T bitcoind bitcoin-cli -regtest -rpcuser=opendeal -rpcpassword=opendeal "$@"; }
```

> [!TIP]
> Use a function, not an alias. `-T` stops Docker from allocating a TTY, which would otherwise append a stray `\r` to every address and break `$(...)` captures.

**2. Create a wallet and mine spendable coins**

```bash
btc createwallet demo
MINER=$(btc getnewaddress)
echo "$MINER"                        # bcrt1... address
btc generatetoaddress 101 "$MINER"   # prints 101 block hashes
btc getbalance                       # 50.00000000
```

Only the first coinbase reward is mature after 101 blocks, which is plenty for the demo.

**3. Generate settlement addresses**

The signed agreement fixes where funds can go. Create one address for each outcome:

```bash
SELLER_PAYOUT=$(btc getnewaddress)
BUYER_REFUND=$(btc getnewaddress)
echo "payout: $SELLER_PAYOUT"
echo "refund: $BUYER_REFUND"
```

Keep these handy for Part 2 and Part 4.

**Reconnecting later**

| Situation | Run |
|---|---|
| New terminal | The `btc()` line and `MINER=$(btc getnewaddress)` again. Re-`echo` your saved payout and refund addresses, or reuse them from your notes |
| Container restarted | `btc loadwallet demo` |
| `createwallet` says the wallet exists | `btc loadwallet demo` |

---

## Part 1: Create identities

Use one browser window per participant, so each has its own session and signing key:

| Role | Window |
|---|---|
| Seller | Normal Chrome window |
| Buyer | Chrome incognito window |
| Mediator | Another browser, or a second Chrome profile |

In **each** window:

1. Click **Sign in** in the header (or **Sign in or create identity** in the footer). This opens `/onboarding`.
2. Under **Create a new identity**, enter a recovery passphrase of at least 12 characters twice.
3. Optional: tick **Also keep the encrypted identity on this device**. The browser then stores only the encrypted file; you still need the passphrase to unlock it.
4. Click **Create identity**.
5. Expect: `opendeal-identity-xxxxxxxx.json` downloads, and the page shows **Signed in as …** with **Signing key unlocked in memory for this tab**.
6. Keep the file and passphrase. To sign in again later, open `/onboarding` and use **Unlock your identity on this device** or **Restore from a recovery file**.
7. Click **Copy pubkey** in the footer. The seller needs the buyer's and mediator's public keys for Part 2.

Sign-in never sends your key to the API. The browser signs a one-time challenge (`/auth/nostr/challenge`, then `/auth/nostr/login`).

## Part 1b: Approve the mediator

A deal can only name a mediator the API has approved.

1. **One-time setup (operator):** choose an administrator identity and add its public key to `OPENDEAL_ADMIN_PUBKEYS` in `crates/opendeal-api/.env`, then restart `make api`. Alternatively, list trusted mediator keys in `MEDIATOR_PUBKEYS`.
2. **Mediator window:** open **Mediator** in the header, enter a **Mediator display name**, and click **Sign and submit application**. The application is signed with the mediator's key and starts as `pending`.
3. **Administrator window:** sign in as the administrator, open **Mediator**, click **Administrator: review registrations**, and click **Approve** on the application.
4. The mediator now appears in the **Approved mediator** list on `/deals/new`.

---

## Part 2: Create and sign the deal

> **Optional:** prepare the terms in the terminal first with `make tui` and import them on `/deals/new` (**Import prepared configuration**). See [tui.md](./tui.md). The steps below work the same either way.

**Seller window**

1. Go to `/deals/new`.
2. Title and amount are prefilled (`Used laptop`, `50000` sats). Change them if you like.
3. Choose the buyer (add their public key under **Add a buyer contact** first) and an **Approved mediator**.
4. Paste `$SELLER_PAYOUT` into **Seller payout address** and `$BUYER_REFUND` into **Buyer refund address**.
5. Click **Create deal**.
6. Expect a redirect to `/deals/<id>` with status `draft`.
7. In the **Agreement** card, click **Sign agreement**. The button changes to **You already signed**.

**Buyer window**

8. Open the same deal URL (copy it from the seller window).
9. Click **Sign agreement**.

**Expect:** status `agreed`, both signatures in the **Timeline**.

---

## Part 3: Fund the escrow

**Seller window**

1. Click **Prepare funding**.
2. Expect a **Funding instructions** card with the `bcrt1…` 2-of-3 escrow address, the expected amount in sats and BTC, and the confirmations needed. Click **Copy address**.

**Terminal C**

3. Send exactly the deal amount and mine a block:

   ```bash
   btc sendtoaddress <escrow_address> 0.0005   # 50,000 sats
   btc generatetoaddress 1 "$MINER"
   ```

   | Sats | BTC |
   |---|---|
   | 50,000 | `0.0005` |
   | 100,000 | `0.001` |

**Seller window**

4. Click **Verify funding**.

**Expect:** status `funded`, funding txid and confirmation count shown.

---

## Part 4: Delivery and settlement

**Delivery**

1. **Seller window:** click **Mark shipped**. Status becomes `shipped`.
2. **Buyer window:** click **Accept delivery**. Status becomes `accepted`.

**Propose**

3. **Seller window**, in the **Settlement PSBT** card:
   - **Purpose:** `Payout seller`
   - **Destination address:** `$SELLER_PAYOUT`, the same address signed into the agreement
   - **Fee (sats):** `500`
4. Click **Propose settlement**.

**Review and sign** (repeat in the seller and buyer windows)

5. Check the decoded **Inputs** and **Outputs**: amount, destination, and fee.
6. Tick **I reviewed the purpose, destination, output amount, and fee.**
7. Click **Sign with local secret**. Use **Decline to sign** if anything looks wrong.
8. Watch the signature count reach `2 of 3`.

**Broadcast and confirm**

9. Click **Finalize / broadcast**. The phase moves to `broadcast` and the page polls every 5 seconds.
10. In terminal C, mine a block:

    ```bash
    btc generatetoaddress 1 "$MINER"
    ```

11. Click **Check confirmation**. Leave the block hash field empty; Core runs with `txindex`.

**Expect:** status `settled`, settlement txid and block hash shown.

**Receipt**

12. Click **Verify receipt**, then **Download receipt JSON** to save the signed JSON receipt.
13. Verify it offline:

    ```bash
    cargo run -p regtest-demo -- verify-receipt <path-to-receipt.json>
    ```

---

## Part 5: Dispute path (optional)

Repeat Parts 2 and 3 to get a fresh funded deal first.

1. **Buyer window:** click **Open dispute**.
2. Either party adds a note under **Evidence** and clicks **Submit evidence**. Each item shows its SHA-256 and a **Download** button for the original content.
3. **Mediator window:** go to `/mediator` (the **Dispute desk**).
4. Pick the dispute from the list. The detail panel shows the full reason, who opened it, and when. On a phone it scrolls into view below the list.
5. Write a **Rationale**.
6. Click **Release to seller** or **Refund buyer**. The panel updates to show the decision, rationale, and resolver, and the decision buttons disappear.
7. Click **Open deal PSBT panel →**. The deal opens with the matching purpose preselected.
8. Continue as in Part 4 from **Propose**, with the mediator plus one party signing. For a refund, the destination is `$BUYER_REFUND`.

---

## Fallback: terminal-only lifecycle

Use this if the browser path breaks mid-demo. It runs the whole lifecycle with off-server PSBT signing, through to `settled` and receipt verification. The API must already be running.

```bash
make e2e
```

Expect `live-e2e SUCCESS` and `receipt ok`. Open the printed deal ID at `http://localhost:3000/deals/<id>` to show the settled state, timeline, and receipt in the UI.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `service "bitcoind" is not running` | Containers not started | `make up` |
| `Error: Invalid address` on `generatetoaddress` | `$MINER` is empty in this shell | Re-run the `btc()` and `MINER=$(btc getnewaddress)` lines |
| `Requested wallet does not exist or is not loaded` | Container restarted | `btc loadwallet demo` |
| `bind: address already in use` on `make up` | Another stack holds the Postgres port | Set a free `POSTGRES_HOST_PORT` in `.env` and match `DATABASE_*` in `crates/opendeal-api/.env` |
| `Sign in first (Sign in page).` or **Sign in to view this deal** | No session in this window | Click **Sign in** and create, unlock or restore that participant's identity |
| **Your sign-in expired** | The JWT is older than 60 minutes | Click **Sign in again** in the footer (signs a fresh challenge with the key in memory), or unlock again on `/onboarding` |
| **Not a party to this deal** | The signed-in identity is not the seller, buyer, or mediator | Open the deal in that party's window |
| Red **API offline** dot | API stopped or unreachable | Restart `make api`; the banner clears by itself |
| `no signing key (needed for agreement sign)` | Signed in with a Nostr extension, or the tab was refreshed | Unlock the identity on `/onboarding` (device copy or recovery file) |
| `agreement has no signed destination…` | Deal was created before the address fields existed | Create a new deal with both addresses filled in |
| `destination contradicts signed agreement` | **Destination address** differs from the signed one | Use the exact payout (or refund) address from Part 2 |
| **Copy pubkey** shows **Copy failed** | Clipboard blocked (non-HTTPS origin or permissions) | Hover the button to see the full key in its tooltip |
| **Finalize / broadcast** is disabled | Fewer than 2 valid signatures | Sign from a second party's window |

---

## Shut down

1. Press `Ctrl+C` in terminal A (API) and terminal B (frontend).
2. Stop Postgres and bitcoind:

   ```bash
   make down
   ```

Data volumes are kept, so the next `make up` restores the database and the regtest chain, including any settled deals.
