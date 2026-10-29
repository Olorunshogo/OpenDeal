#!/usr/bin/env bash
# Regtest helpers for UI demos. Reads BITCOIN_RPC_URL/USER/PASSWORD from the root .env
# (or crates/opendeal-api/.env) without printing them, so they always target the same node as
# the API (Polar or the Compose bitcoind). Refuses to run on any chain but regtest.
# Set WALLET (or BITCOIN_RPC_WALLET in .env) when the node has more than one wallet loaded.
#
#   scripts/regtest.sh info                       node, chain, height, wallets, balance
#   scripts/regtest.sh wallet                     load or create a wallet, mine 101 blocks if low
#   scripts/regtest.sh addresses                  two fresh wallet addresses (seller payout, buyer refund)
#   scripts/regtest.sh fund <address> [btc]       send 0.0005 BTC (or [btc]) and mine 1 block
#   scripts/regtest.sh mine [n]                   mine 1 block (or [n])
#   scripts/regtest.sh cli <method> [json-array]  any bitcoin-cli RPC, e.g. cli getblockcount
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
WALLET_NAME="${WALLET:-${BITCOIN_RPC_WALLET:-$(env_value BITCOIN_RPC_WALLET)}}"
W="/wallet/${WALLET_NAME}"
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
  local n="${1:-1}" to
  [[ "$n" =~ ^[0-9]+$ && "$n" -gt 0 ]] || { echo "Block count must be a positive number." >&2; exit 1; }
  to=$(rpc "$W" getnewaddress '["mining","bech32"]')
  rpc "" generatetoaddress "[$n,\"$to\"]" >/dev/null
  echo "Mined $n block(s) (height $(rpc "" getblockcount '[]'))."
}

ensure_wallet() {
  local loaded name
  loaded=$(rpc "" listwallets '[]')
  name="${WALLET_NAME:-demo}"
  if [[ -z "$WALLET_NAME" && "$loaded" != "[]" ]]; then
    if python3 -c 'import sys,json; sys.exit(0 if len(json.loads(sys.argv[1]))==1 else 1)' "$loaded"; then
      echo "Using the node's only loaded wallet."
      return
    fi
    echo "Several wallets are loaded: $loaded. Pick one with WALLET=<name>." >&2
    exit 1
  fi
  if python3 -c 'import sys,json; sys.exit(0 if sys.argv[2] in json.loads(sys.argv[1]) else 1)' "$loaded" "$name"; then
    echo "Wallet '$name' is loaded."
  elif rpc "" loadwallet "[\"$name\"]" >/dev/null 2>&1; then
    echo "Loaded wallet '$name'."
  else
    rpc "" createwallet "[\"$name\"]" >/dev/null
    echo "Created wallet '$name'."
  fi
  W="/wallet/$name"
}

case "${1:-}" in
  info)
    echo "Node RPC:  ${URL#*://} (user ${USER_})"
    echo "Chain:     $chain, height $(rpc "" getblockcount '[]')"
    echo "Wallets:   $(rpc "" listwallets '[]')"
    echo "Using:     ${WALLET_NAME:-the only loaded wallet}"
    echo "Balance:   $(rpc "$W" getbalance '[]' 2>/dev/null || echo 'n/a (run make wallet)') BTC"
    ;;
  wallet)
    ensure_wallet
    balance=$(rpc "$W" getbalance '[]')
    if python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) < 1 else 1)' "$balance"; then
      echo "Balance is $balance BTC, mining 101 blocks so a coinbase matures."
      mine 101
      balance=$(rpc "$W" getbalance '[]')
    fi
    echo "Wallet balance: $balance BTC"
    ;;
  addresses)
    echo "Seller payout address: $(rpc "$W" getnewaddress '["seller-payout","bech32"]')"
    echo "Buyer refund address:  $(rpc "$W" getnewaddress '["buyer-refund","bech32"]')"
    ;;
  fund)
    addr="${2:-}"
    amount="${3:-0.0005}"
    [[ "$addr" == bcrt1* ]] || { echo "Usage: make fund ADDR=<bcrt1… escrow address> [AMOUNT=<btc>]" >&2; exit 1; }
    [[ "$amount" =~ ^[0-9]*\.?[0-9]+$ ]] || { echo "AMOUNT must be a BTC amount, e.g. 0.0005" >&2; exit 1; }
    txid=$(rpc "$W" sendtoaddress "[\"$addr\",$amount]")
    echo "Sent $amount BTC to the escrow. Transaction: $txid"
    mine
    echo "Now click 'Verify funding' in the browser."
    ;;
  mine) mine "${2:-1}" ;;
  cli)
    method="${2:-}"
    [[ "$method" =~ ^[a-z]+$ ]] || { echo "Usage: make btc METHOD=<rpc method> [PARAMS='[...]']" >&2; exit 1; }
    rpc "$W" "$method" "${3:-[]}"
    ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
