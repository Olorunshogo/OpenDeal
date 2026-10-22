-- Additive only. Signed description/destination terms live in agreement_json.
ALTER TABLE deals ADD COLUMN settlement_purpose TEXT;
ALTER TABLE deals ADD COLUMN settlement_proposal TEXT;
ALTER TABLE deals ADD COLUMN settlement_phase TEXT NOT NULL DEFAULT 'none';
ALTER TABLE deals ADD COLUMN settlement_confirmations INT NOT NULL DEFAULT 0;
ALTER TABLE deals ADD COLUMN settlement_block_hash TEXT;
ALTER TABLE deals ADD COLUMN settlement_raw_tx TEXT;
ALTER TABLE deals ADD COLUMN settlement_from_status TEXT;
ALTER TABLE deals ADD COLUMN broadcast_attempted_at TIMESTAMPTZ;
ALTER TABLE deal_evidence ADD COLUMN IF NOT EXISTS content_sha256 TEXT;
CREATE UNIQUE INDEX disputes_one_open_per_deal ON disputes (agreement_id) WHERE status = 'open';
-- A single escrow outpoint cannot fund two agreements, even for repeated parties.
CREATE UNIQUE INDEX deals_unique_funding_outpoint ON deals (funding_txid, funding_vout) WHERE funding_txid IS NOT NULL;
-- The existing script is derived only from participant keys, not agreement_id.
-- Reusing an address across agreements would make their deposits ambiguous.
CREATE UNIQUE INDEX deals_unique_escrow_address ON deals (escrow_address) WHERE escrow_address IS NOT NULL;
