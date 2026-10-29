#!/usr/bin/env bash
# Regtest helpers for UI demos. Reads BITCOIN_RPC_URL/USER/PASSWORD from the root .env
# (or crates/opendeal-api/.env) without printing them. Refuses to run on any chain but regtest.
#
#   scripts/regtest.sh addresses        two fresh wallet addresses (seller payout, buyer refund)
#   scripts/regtest.sh fund <address>   send 0.0005 BTC (50,000 sats) and mine 1 block
#   scripts/regtest.sh mine             mine 1 block
set -euo pipefail
cd "$(dirname "$0")/.."

env_value() {
  local name="$1" file
  for file in crates/opendeal-api/.env .env; do
    if [[ -f "$file" ]] && grep -q "^${name}=" "$file"; then
      grep "^${name}=" "$file" | tail -1 | cut -d= -f2- | tr -d '"\r'
      return
    fi
  done
}

URL="${BITCOIN_RPC_URL:-$(env_value BITCOIN_RPC_URL)}"
USER_="${BITCOIN_RPC_USER:-$(env_value BITCOIN_RPC_USER)}"
PASS_="${BITCOIN_RPC_PASSWORD:-$(env_value BITCOIN_RPC_PASSWORD)}"
URL="${URL%/}"
URL="${URL%/wallet/*}"   # node URL; wallet calls add /wallet/ (default wallet) below
[[ -n "$URL" && -n "$USER_" ]] || { echo "BITCOIN_RPC_URL/USER not set in .env" >&2; exit 1; }

rpc() { # rpc <path> <method> <json params>
  local out
  out=$(curl -s -m 15 --user "$USER_:$PASS_" -H 'content-type: text/plain' \
    --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"demo\",\"method\":\"$2\",\"params\":$3}" "$URL$1") \
    || { echo "Bitcoin node unreachable at its RPC URL" >&2; exit 1; }
  python3 -c 'import sys,json
d=json.loads(sys.argv[1])
if d.get("error"): sys.exit("bitcoin rpc error: "+d["error"]["message"])
r=d["result"]; print(r if not isinstance(r,(list,dict)) else json.dumps(r))' "$out"
}

chain=$(rpc "" getblockchaininfo '[]' | python3 -c 'import sys,json;print(json.loads(sys.stdin.read())["chain"])')
[[ "$chain" == "regtest" ]] || { echo "Refusing: node is on '$chain', not regtest." >&2; exit 1; }

mine() {
  local to; to=$(rpc /wallet/ getnewaddress '["mining","bech32"]')
  rpc "" generatetoaddress "[1,\"$to\"]" >/dev/null
  echo "Mined 1 block (height $(rpc "" getblockcount '[]'))."
}

case "${1:-}" in
  addresses)
    echo "Seller payout address: $(rpc /wallet/ getnewaddress '["seller-payout","bech32"]')"
    echo "Buyer refund address:  $(rpc /wallet/ getnewaddress '["buyer-refund","bech32"]')"
    ;;
  fund)
    addr="${2:-}"
    [[ "$addr" == bcrt1* ]] || { echo "Usage: make fund ADDR=<bcrt1… escrow address>" >&2; exit 1; }
    txid=$(rpc /wallet/ sendtoaddress "[\"$addr\",0.0005]")
    echo "Sent 50,000 sats to the escrow. Transaction: $txid"
    mine
    echo "Now click 'Verify funding' in the browser."
    ;;
  mine) mine ;;
  *) sed -n '2,8p' "$0"; exit 1 ;;
esac
