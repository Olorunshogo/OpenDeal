# Quick demo (two browser windows)

The shortest path through a full OpenDeal deal on regtest. You play the **seller** in a normal
Chrome window and the **buyer** in an incognito window. The mediator is one of the approved
mediators already configured on the API; it only acts if there is a dispute.

## Start

```bash
make api        # terminal 1
make frontend   # terminal 2
```

Open http://localhost:3000 in a normal window (seller) and an incognito window (buyer).

## 1. Sign in (both windows)

**Sign in** → **Create identity** (any passphrase, 12+ characters). A recovery file downloads.

In the **buyer** window, click **Copy pubkey** in the footer.

## 2. Create the deal (seller)

```bash
make addresses
```

**New deal** →

- **Add a buyer contact**: paste the buyer pubkey → **Save public contact**
- **Approved mediator**: pick any
- Paste the two addresses from `make addresses`
- **Create deal**

Copy the deal page URL into the buyer window.

## 3. Sign (both)

**Sign agreement** in each window. Status: `agreed`.

## 4. Fund (seller)

**Prepare funding** → copy the escrow address, then:

```bash
make fund ADDR=<escrow address>
```

**Verify funding**. Status: `funded`.

## 5. Settle

| Window | Click |
|---|---|
| Seller | **Mark shipped** |
| Buyer | **Accept delivery** |
| Seller | Settlement: **Payout seller**, destination = seller payout address, fee `500` → **Propose settlement** |
| Seller, then buyer | Tick the review box → **Sign with local secret** |
| Seller | **Finalize / broadcast** |

```bash
make mine
```

Seller: **Check confirmation**. Status: `settled`. **Export receipt** to download proof.

Full walkthrough with disputes and a self-run mediator: [demo.md](./demo.md).
