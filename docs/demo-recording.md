# Demo recording backup

If live regtest fails during a pitch, use a pre-recorded walkthrough.

## Suggested four-minute narrative

1. **0:00 to 0:40**: Trust problem (WhatsApp laptop sale)
2. **0:40 to 1:20**: Create deal and dual-sign agreement
3. **1:20 to 2:10**: Fund 2-of-3 escrow; show confirmations
4. **2:10 to 2:50**: Joint PSBT payout
5. **2:50 to 3:30**: Dispute path with mediator decision and refund PSBT
6. **3:30 to 4:00**: Export receipt; offline verify with `regtest-demo`

## Offline protocol smoke (no bitcoind)

```bash
cargo run -p regtest-demo -- laptop-sale | tee /tmp/opendeal-receipt.json
# Extract the JSON object from the output into a file, then:
cargo run -p regtest-demo -- verify-receipt /tmp/opendeal-receipt.json
```

## Recording location

Store the backup screen recording outside git (large binary):

```
~/Movies/OpenDeal/demo-backup.mp4
```

Keep a short note here when a recording exists:

- [ ] Backup recording captured
- Path: `~/Movies/OpenDeal/demo-backup.mp4`
- Date:
- Covers: happy path / dispute / receipt verify
