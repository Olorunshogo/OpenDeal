# OpenDeal: full demo test on your machine

This runs one complete deal on **regtest** (play money):
**create identities → prepare the deal in the TUI → create → sign → fund → ship → accept → pay out → receipt.**
You play both the seller and the buyer in two browser windows. It takes about 20 minutes the first time.

---

## 0. What you need installed

| Tool | Check |
|---|---|
| Rust (stable, 1.85+) | `cargo --version` |
| Node 20+ and pnpm | `node -v && pnpm -v` |
| Docker | `docker ps` |
| Polar | https://lightningpolar.com |
| Chrome (or any Chromium browser) | for the two windows |
| `python3` and `curl` | the `make fund/mine/addresses` helpers use them |

Get the latest code:

```bash
git checkout develop && git pull
```

---

## 1. Polar: the Bitcoin regtest node

1. Open Polar and click **Create Network**. Any layout works; one Bitcoin Core node is all OpenDeal needs (Lightning nodes are optional).
2. Click **Start** and wait until everything shows green.
3. Click the **Bitcoin Core** node (for example `backend1`) and open the **Connect** tab. Note these values:
   - **RPC Host**, for example `http://127.0.0.1:18443`. The port varies per Polar network (18443, 18444, 18445…), so use the one shown.
   - **Username**: Polar's default is `polaruser`.
   - **Password**: Polar's default is `polarpass`.
4. Give the node's wallet spendable coins. Newly mined coins need 100 more blocks before they can be spent, so mine 101 blocks once. In Polar: right-click the Bitcoin node → **Mine blocks** → `101`. You can also run this after step 2:
   ```bash
   for i in $(seq 101); do make -s mine >/dev/null; done
   ```

---

## 2. Postgres

Start **only** Postgres. Don't use `make up`: it also starts a second bitcoind on port 18443, which can clash with Polar.

```bash
cp .env.example .env          # root .env: only the Compose host ports
docker compose up -d postgres # Postgres on 127.0.0.1:5435, user/password/db = opendeal
```

---

## 3. API settings: `crates/opendeal-api/.env`

```bash
cp crates/opendeal-api/.env.example crates/opendeal-api/.env
```

Edit `crates/opendeal-api/.env` and set at least these lines. Leave the rest as they are in the example.

```dotenv
APP_ENV=development
PORT=8080

# Postgres from step 2 (Compose default credentials)
DATABASE_URL=postgres://opendeal:opendeal@127.0.0.1:5435/opendeal
DATABASE_ADMIN_URL=postgres://opendeal:opendeal@127.0.0.1:5435/opendeal
RUN_MIGRATIONS=true

CORS_ALLOWED_ORIGINS=http://localhost:3000

# Generate your own value: openssl rand -hex 32
JWT_SECRET=<paste output of: openssl rand -hex 32>
WEBHOOK_SIGNING_SECRET=<paste output of: openssl rand -hex 32>

SETTLEMENT_MODEL=bitcoin_multisig_2of3
BITCOIN_NETWORK=regtest
BITCOIN_REQUIRED_CONFIRMATIONS=1

# Polar step 1.3: use the RPC host/port and credentials from YOUR Connect tab
BITCOIN_RPC_URL=http://127.0.0.1:18443
BITCOIN_RPC_USER=polaruser
BITCOIN_RPC_PASSWORD=polarpass

# Filled in at step 5 (the mediator's public key). Leave empty for now.
MEDIATOR_PUBKEYS=

# Keep these off. The demo uses the normal sign-in flow.
OPENDEAL_DEMO_ENABLED=false
OPENDEAL_DEV_SESSION_ENABLED=false
```

Notes:
- The API reads `crates/opendeal-api/.env` first, then the root `.env`. Keep all API settings in the crate file so they don't conflict.
- `make addresses`, `make fund` and `make mine` read the same RPC settings and refuse to run if the node is not on regtest.
- Never commit `.env` files.

---

## 4. Frontend settings and start everything

```bash
cp frontend/.env.example frontend/.env.local   # API at http://localhost:8080; no changes needed
make install-frontend                          # pnpm install, first time only
```

Use three terminals:

```bash
make api        # terminal 1: runs migrations on first boot, then listens on :8080
make frontend   # terminal 2: http://localhost:3000
                # terminal 3: for the commands below
```

Check that it's up:

```bash
curl -s localhost:8080/health          # → ok
curl -s localhost:8080/health/ready    # → HTTP 200 (database reachable)
make addresses                         # prints two bcrt1… addresses (Polar reachable)
```

If `make addresses` works but `make fund` later says *Insufficient funds*, mine the 101 blocks from step 1.4.

---

## 5. One-time: create a mediator

Every deal needs an approved mediator. It only acts if there's a dispute, so for this demo it never has to do anything. The mediator still needs a real identity.

1. Open a **guest/third browser window** and go to http://localhost:3000. Click **Sign in**, then **Create identity**, and choose a passphrase of 12+ characters.
2. A recovery file `opendeal-identity-XXXXXXXX.json` downloads. Keep it, and **rename it to `mediator-identity.json`** so it doesn't get mixed up with the others.
3. Click **Copy pubkey** in the page footer.
4. Paste it into `crates/opendeal-api/.env`: `MEDIATOR_PUBKEYS=<that pubkey>`.
5. Restart the API (Ctrl+C in terminal 1, then `make api`).
6. `curl -s localhost:8080/api/v1/mediators` should now list it as approved. You can close this window.

---

## 6. Create the seller and buyer

| Window | Do |
|---|---|
| **Seller**: normal Chrome window | http://localhost:3000 → **Sign in** → **Create identity** |
| **Buyer**: incognito window | same |

Each one downloads `opendeal-identity-XXXXXXXX.json`. The 8 characters `XXXXXXXX` are the start of the key shown under **Signed in as …**, so you can tell which file is the seller's and which is the buyer's.

> **Don't reload deal pages.** The signing key lives only in that tab's memory. If you do reload, go to
> **Sign in → Restore from a recovery file**, choose that person's file, enter the passphrase, then
> click **Continue**. Deal pages refresh themselves every 5 seconds, so you never need to reload.

---

## 7. Prepare the deal in the TUI

```bash
make addresses
```

Keep both: the first is the **seller payout** address, the second the **buyer refund** address.

```bash
make tui ARGS="--seller-file ~/Downloads/opendeal-identity-<seller8>.json --buyer-file ~/Downloads/opendeal-identity-<buyer8>.json"
```

Keys: **↑/↓** to move, **Enter** to open or edit, **Esc** to go back to the menu, **q** to quit.

1. **Dashboard**: check it shows `API ● online`, `REGTEST`, Seller ✔ and Buyer ✔.
2. **Mediator (registry)**: press **Enter** on your mediator, then **Esc**.
3. **Deal terms**:
   - Press **↓** to reach **Seller payout address**, press **Enter**, paste the first address, and press **Enter**.
   - Do the same for **Buyer refund address** with the second address.
   - Leave the amount at **50000**, because `make fund` sends exactly 50,000 sats.
   - Expect **✔ Terms valid**, then press **Esc**.
4. **Escrow address**: press **d**. Note the first characters of the address, which is *derived only, not funded*. Then press **Esc**.
5. **Export configuration**: press **e**. This writes `data/prepared/opendeal-prepared-deal.json`; press **o** if it asks to overwrite.
6. Press **Esc**, then **q**.

The TUI never sees private keys. The exported file contains only public keys, addresses and terms.

---

## 8. Create the deal (seller window)

1. Go to **New deal** and open **Import prepared configuration (from opendeal-tui)**.
2. Choose `data/prepared/opendeal-prepared-deal.json`, which is in the repo folder.
3. Check that all three items show ✔:
   - The escrow address, which should match the TUI.
   - The seller is the signed-in identity.
   - The mediator is approved.
4. Click **Apply to form**, then **Create deal**.
5. The status is **draft**: the deal exists, but no money has moved yet. Copy the page URL into the **buyer** window.

## 9. Sign (both windows)

Click **Sign agreement** in each window. Within a few seconds both windows show **agreed**.

## 10. Fund (seller window and terminal)

1. Click **Prepare funding**. The escrow address shown must match the TUI's.
2. Run:
   ```bash
   make fund ADDR=<escrow address>   # sends 50,000 sats and mines 1 block
   ```
3. Click **Verify funding**. The status becomes **funded**.

## 11. Ship, accept, pay out

| Window | Click |
|---|---|
| Seller | **Mark shipped** |
| Buyer | **Accept delivery** |
| Seller | Settlement: Purpose **Payout seller**, Destination = the seller payout address, Fee `500`, then **Propose settlement** |
| Seller | Tick *"I reviewed the purpose…"*, then **Sign with local secret** |
| Buyer | Wait for the proposal to appear (≤5 s), tick the box, then **Sign with local secret** |
| Seller | Once it shows 2/2 signatures, click **Finalize / broadcast** |

Then run:

```bash
make mine
```

In the seller window, click **Check confirmation**. The status becomes **settled**. Then click **Export receipt** and **Download receipt JSON** to save the proof.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `make api` fails with `JWT_SECRET must be set` or `DATABASE_URL must be set` | Check `crates/opendeal-api/.env` (step 3). |
| Port 8080 or 3000 already in use | `lsof -i :8080` (or `:3000`), then stop that process. |
| TUI shows no mediators | `MEDIATOR_PUBKEYS` is empty or the API wasn't restarted (step 5). |
| `make fund`: *Insufficient funds* | Mine 101 blocks (step 1.4). |
| `make addresses/fund`: *Requested wallet does not exist* or *wallet file not specified* | The Polar node has no default wallet, or has several loaded. In terminal 3, run `docker exec -it polar-n1-backend1 bitcoin-cli -regtest -rpcuser=polaruser -rpcpassword=polarpass listwallets`, replacing the container name and credentials with yours. The helper expects the default (`""`) wallet. |
| Bitcoin RPC connection refused | The Polar network isn't started, or the port in `BITCOIN_RPC_URL` doesn't match the Connect tab. |
| A button is greyed out | It isn't your turn or your role. The box at the top of the deal page says who acts next. |
| Signed out / *No signing key in this tab* | The page was reloaded. Use **Sign in → Restore from a recovery file** (see step 6). |
| Old "Demo seller/buyer" contacts in the buyer list | They're dropped automatically. Use **Remove this saved contact** for anything else. |

Further reading: `docs/quick-demo.md` (the same flow without the TUI), `docs/tui.md`, and `docs/demo.md` (disputes and the mediator flow).
