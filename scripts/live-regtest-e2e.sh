#!/usr/bin/env bash
# Full live regtest demo: Compose services + API + off-server 2-of-3 PSBT.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_URL="${API_URL:-http://127.0.0.1:8080}"
BITCOIN_RPC_URL="${BITCOIN_RPC_URL:-http://opendeal:opendeal@127.0.0.1:18443}"
RECEIPT_OUT="${RECEIPT_OUT:-/tmp/opendeal-live-receipt.json}"

echo "== Starting Postgres + bitcoind =="
# Postgres binds host :5435 by default; override if taken: POSTGRES_HOST_PORT=<free port> ./scripts/live-regtest-e2e.sh
docker compose up -d
echo "Waiting for healthchecks..."
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U opendeal -d opendeal >/dev/null 2>&1 \
    && docker compose exec -T bitcoind bitcoin-cli -regtest -rpcuser=opendeal -rpcpassword=opendeal getblockchaininfo >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf "$API_URL/health" >/dev/null; then
  echo "API not reachable at $API_URL"
  echo "In another terminal (from repo root):"
  echo "  cp -n crates/opendeal-api/.env.example crates/opendeal-api/.env"
  echo "  # Match DATABASE_URL port to POSTGRES_HOST_PORT if you overrode it"
  echo "  cargo run -p opendeal-api"
  echo "Then re-run this script."
  exit 1
fi

echo "== Running cargo live-e2e =="
cargo run -p regtest-demo --quiet -- live-e2e \
  --api-url "$API_URL" \
  --bitcoin-rpc-url "$BITCOIN_RPC_URL" \
  --receipt-out "$RECEIPT_OUT"

echo
echo "Offline verify:"
cargo run -p regtest-demo --quiet -- verify-receipt "$RECEIPT_OUT"
echo "Done. Receipt: $RECEIPT_OUT"
