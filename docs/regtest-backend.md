# Running the backend against Polar regtest

Run commands from the repository root. Keep your existing `.env`; do not replace
it with the example. For a fresh setup, copy `crates/opendeal-api/.env.example`
to `.env` only if `.env` does not exist, then replace the placeholders locally.

Configure `DATABASE_URL` and `DATABASE_ADMIN_URL` for the existing `opendeal`
database at `127.0.0.1:5435`. The admin role must have migration privileges;
the application role needs access to the tables and sequences. Both URLs must
refer to the same database. Use a random `JWT_SECRET` of at least 32 characters.

Set these values in your local environment file:

```dotenv
RUN_MIGRATIONS=true
BITCOIN_RPC_URL=http://127.0.0.1:18445
BITCOIN_RPC_USER=polaruser
BITCOIN_RPC_PASSWORD=replace-with-your-existing-polar-rpc-password
BITCOIN_NETWORK=regtest
SETTLEMENT_MODEL=bitcoin_multisig_2of3
```

The API loads `crates/opendeal-api/.env` and then `.env` without overriding exported variables. You can also export settings from a
trusted, shell-compatible `.env` before running it:

```bash
set -a
source .env
set +a
cargo run -p opendeal-api
```

In another terminal:

```bash
curl -i http://127.0.0.1:8080/health
curl -i http://127.0.0.1:8080/health/ready
curl -iL http://127.0.0.1:8080/docs
```

`/health` returns `ok`. `/health/ready` queries PostgreSQL and returns `ready`
(or HTTP 503 when unavailable). Neither endpoint probes Bitcoin Core. `/docs`
may redirect to `/docs/` and serves Swagger UI.

Load the same environment and run the read-only Bitcoin connectivity test:

```bash
cargo test -p opendeal-bitcoin --test rpc_connectivity -- --nocapture
```

This calls only `getblockcount`. Missing or empty RPC variables produce an
explicit skip message; with all three set, connection/authentication/invalid
response failures fail the test. A skipped test is not evidence of connectivity.

RPC requests use HTTP Basic authentication with separate username/password
settings. Credentials are not included in client errors or configuration Debug
output. Keep Basic authentication on loopback or use an HTTPS protected channel
for remote RPC access. Do not put credentials in `BITCOIN_RPC_URL`.

Startup runs embedded SQLx migrations only when `RUN_MIGRATIONS=true`, using
`DATABASE_ADMIN_URL`. Errors prevent startup. SQLx tracks applied versions and
checksums; do not edit an already applied migration or run the initial migration
against pre-existing untracked tables. No schema changes are needed for this fix.
Without `BITCOIN_RPC_URL`, development uses the existing mock RPC; production
multisig configuration requires a URL. Startup alone never verifies live RPC.

## Opt-in escrow funding and settlement test

`regtest_escrow` contains an ignored live test plus ordinary offline signing and
amount tests. The live test requires both `--ignored` and
`OPENDEAL_LIVE_REGTEST=1`. Missing required variables fail an explicitly requested
live run. Ordinary workspace tests never execute this state-changing test.

Use an existing, loaded, unlocked, spend-capable Polar regtest wallet. Set
`BITCOIN_RPC_WALLET` to its exact name. The root RPC endpoint must not contain
credentials or a wallet path. From the repository root:

```bash
set -a
source .env
set +a
export BITCOIN_RPC_WALLET='your-loaded-polar-wallet-name'
OPENDEAL_LIVE_REGTEST=1 \
BITCOIN_NETWORK=regtest \
BITCOIN_RPC_URL=http://127.0.0.1:18445 \
cargo test -p opendeal-bitcoin --test regtest_escrow \
  live_regtest_escrow_lifecycle -- --ignored --exact --nocapture
```

The `.env` must supply `BITCOIN_RPC_USER` and `BITCOIN_RPC_PASSWORD`. No dotenv
file is loaded automatically. No test private key is sent to Core or the API.
The configured Core wallet's existing keys fund the test; fresh buyer, seller,
and mediator keys remain local to the test process. There is no API or database
connection in this test.

Before any wallet mutation, the test checks Core's actual chain is `regtest`.
It creates two wallet addresses and mines 101 blocks if the wallet balance is
below 120,000 satoshis, to mature fresh coinbase funds. It sends 100,000 satoshis
to a fresh escrow, mines two confirmation blocks, verifies the precise outpoint,
amount and script, and uses OpenDeal's PSBT builder and combine functions. Local
buyer and seller signatures use the SegWit v0 witness-script sighash and actual
UTXO amount. The final witness contains the empty CHECKMULTISIG dummy, two DER
signatures with SIGHASH_ALL bytes in script public-key order, and witness script.
Core checks acceptance before the existing authenticated client broadcasts it.

The settlement pays 99,000 satoshis back to a new address in the configured
wallet, with a fixed 1,000-satoshi settlement fee. Wallet funding uses an explicit
2 sat/vB fee rate; its actual fee is reported separately. One final block is
mined and the confirmed raw transaction, output, and spent escrow are verified.
Explicit block lookup avoids requiring `txindex`. All amount arithmetic uses
integer satoshis, and test JSON parsing preserves Core's decimal precision.

Successful output includes funding and settlement txids, fees, output amount,
and confirmations. Funding/broadcast txids are also printed as those steps
succeed, so a later failure remains identifiable. Any RPC, signature,
finalization, policy, or broadcast failure fails the test. It leaves generated
blocks and wallet transactions in place; use disposable regtest funds. Keys are
ephemeral: a failure after funding can leave test funds in an unspent escrow.
The test does not modify Polar configuration, containers, or database records.
