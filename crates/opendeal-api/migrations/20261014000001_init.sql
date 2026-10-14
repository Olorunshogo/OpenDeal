CREATE TABLE users (
    pubkey TEXT PRIMARY KEY,
    custody TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deals (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    title TEXT NOT NULL,
    amount_sats BIGINT NOT NULL,
    currency TEXT NOT NULL,
    seller_pubkey TEXT NOT NULL,
    buyer_pubkey TEXT NOT NULL,
    mediator_pubkey TEXT NOT NULL,
    settlement_model TEXT NOT NULL,
    network TEXT NOT NULL,
    agreement_json JSONB NOT NULL,
    escrow_address TEXT,
    escrow_script_pubkey_hex TEXT,
    escrow_witness_script_hex TEXT,
    funding_txid TEXT,
    funding_vout INT,
    funding_amount_sats BIGINT,
    settlement_txid TEXT,
    current_psbt TEXT,
    delivery_deadline TIMESTAMPTZ NOT NULL,
    acceptance_window_hours INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deal_events (
    id BIGSERIAL PRIMARY KEY,
    agreement_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL,
    actor_pubkey TEXT NOT NULL,
    prev_event_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    signature_json JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (agreement_id, sequence)
);

CREATE TABLE deal_evidence (
    id UUID PRIMARY KEY,
    agreement_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    submitted_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
    id UUID PRIMARY KEY,
    agreement_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    opened_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    decision TEXT,
    rationale TEXT,
    resolved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE agreement_signatures (
    agreement_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    pubkey TEXT NOT NULL,
    signature_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agreement_id, pubkey)
);

CREATE TABLE idempotency_keys (
    key TEXT PRIMARY KEY,
    route TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INT NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY,
    owner_pubkey TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY,
    endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at TIMESTAMPTZ
);
