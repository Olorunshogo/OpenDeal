-- Forward-only registry. Existing MEDIATOR_PUBKEYS remain a compatibility source
-- until a row exists; explicit suspension always overrides configuration.
CREATE TABLE mediators (
    id UUID PRIMARY KEY,
    pubkey TEXT NOT NULL UNIQUE CHECK (pubkey ~ '^[0-9a-f]{64}$'),
    display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
);
CREATE INDEX mediators_status_name ON mediators(status, display_name, pubkey);
