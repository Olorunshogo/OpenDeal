# Demo recording backup

If live regtest fails during a pitch, use a pre-recorded walkthrough.

## Prerequisites (live path)

```bash
docker compose up -d
cd crates/opendeal-api && cp -n .env.example .env && cargo run -p opendeal-api
# other terminal
cd frontend && cp -n .env.example .env.local && pnpm install && pnpm dev
```

One-command protocol + chain smoke (API must already be up):

```bash
./scripts/live-regtest-e2e.sh
```

Offline-only (no bitcoind):

```bash
cargo run -p regtest-demo -- laptop-sale | tee /tmp/opendeal-receipt.json
# Extract the JSON object from the output into a file, then:
cargo run -p regtest-demo -- verify-receipt /tmp/opendeal-live-receipt.json
```

## Suggested four-minute narrative

1. **0:00 to 0:40**: Trust problem (WhatsApp laptop sale)
2. **0:40 to 1:20**: Create regtest identities → create deal → dual-sign agreement in UI
3. **1:20 to 2:10**: Fund 2-of-3 escrow (or show `live-e2e` funding); show confirmations
4. **2:10 to 2:50**: Joint PSBT payout (live-e2e signs off-server; UI shows settled + txids)
5. **2:50 to 3:30**: Dispute path with mediator decision and refund PSBT (optional second take)
6. **3:30 to 4:00**: Export receipt; offline verify with `regtest-demo verify-receipt`

## Capture checklist (operator)

Record after `./scripts/live-regtest-e2e.sh` succeeds once on this machine.

```bash
mkdir -p ~/Movies/OpenDeal
# Use your OS recorder (e.g. OBS, gnome-screenshot --interactive, or SimpleScreenRecorder)
# Save as:
#   ~/Movies/OpenDeal/demo-backup.mp4
```

Suggested on-screen sequence for the backup file:

1. Terminal: `./scripts/live-regtest-e2e.sh` through `live-e2e SUCCESS` + `receipt ok`
2. Browser: footer → **Create regtest identity** (seller) → New deal → paste buyer/mediator pubkeys from a second identity
3. Dual-sign: seller signs → switch session to buyer → sign → status `agreed`
4. Show deal timeline + export receipt
5. Terminal: `cargo run -p regtest-demo -- verify-receipt /tmp/opendeal-live-receipt.json`

## Recording location

Store the backup screen recording outside git (large binary):

```
~/Movies/OpenDeal/demo-backup.mp4
```

Keep a short note here when a recording exists:

- [x] Terminal live-e2e proof captured (pitch backup if UI mp4 unavailable)
- Path: `~/Movies/OpenDeal/live-e2e-proof.txt`
- Date: 2026-10-14
- Covers: fund from bitcoind wallet → dual-sign → off-server 2-of-3 PSBT → settle → receipt ok
- [ ] Optional UI screen recording (`~/Movies/OpenDeal/demo-backup.mp4`) — follow capture checklist above

## Auth notes for UI demos

- **Create regtest identity**: mints a JWT via `POST /api/v1/auth/dev/session` (disabled when `APP_ENV=production`) and stores a local signing secret for agreement ECDSA.
- **Connect Nostr extension**: NIP-07 challenge/login (`kind 22242`). Add a signing secret under Advanced if you need to dual-sign agreements in the UI.
