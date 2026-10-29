.PHONY: help up down logs ps api frontend install-frontend build build-api build-frontend e2e e2e-offline migrate check test tui test-tui btc-info wallet addresses fund mine btc

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

help:
	@echo "OpenDeal local commands"
	@echo "  make up              Start Postgres + bitcoind (Docker)"
	@echo "  make down            Stop Postgres + bitcoind"
	@echo "  make logs            Tail Compose logs"
	@echo "  make ps              Compose status"
	@echo "  make api             Run API (loads migrations when RUN_MIGRATIONS=true)"
	@echo "  make frontend        Run Next.js dev server"
	@echo "  make tui             Terminal UI to prepare demo data (see docs/tui.md)"
	@echo "  make btc-info        Which bitcoind the helpers use (same as the API), chain, wallets"
	@echo "  make wallet          Load or create a regtest wallet, mine 101 blocks if it is low"
	@echo "  make addresses       Two regtest wallet addresses (seller payout, buyer refund)"
	@echo "  make fund ADDR=...   Send 50,000 regtest sats (or AMOUNT=<btc>) to an escrow and mine a block"
	@echo "  make mine            Mine one regtest block (or N=<blocks>)"
	@echo "  make btc METHOD=...  Any bitcoin-cli RPC, e.g. make btc METHOD=getblockcount"
	@echo "                       Add WALLET=<name> to any of these when several wallets are loaded"
	@echo "  make install-frontend  pnpm install in frontend/"
	@echo "  make build           Build API (release) + frontend"
	@echo "  make build-api       cargo build --release -p opendeal-api"
	@echo "  make build-frontend  Next.js production build"
	@echo "  make migrate         Same as make api (migrations run on API boot)"
	@echo "  make e2e             Live regtest e2e (API must already be up)"
	@echo "  make e2e-offline     Offline laptop-sale demo (no bitcoind)"
	@echo "  make check           cargo check workspace"
	@echo "  make test            cargo test core + bitcoin + tui"
	@echo "  make test-tui        cargo test opendeal-tui only"

up:
	cd $(ROOT) && docker compose --profile standalone-bitcoin up -d
	@echo "Postgres host port: $$(cd $(ROOT) && docker compose port postgres 5432)"

down:
	cd $(ROOT) && docker compose --profile standalone-bitcoin down

logs:
	cd $(ROOT) && docker compose --profile standalone-bitcoin logs -f

ps:
	cd $(ROOT) && docker compose --profile standalone-bitcoin ps

api:
	cd $(ROOT) && cargo run -p opendeal-api

migrate: api

frontend:
	cd $(ROOT)/frontend && pnpm dev

btc-info:
	@cd $(ROOT) && WALLET="$(WALLET)" ./scripts/regtest.sh info

wallet:
	@cd $(ROOT) && WALLET="$(WALLET)" ./scripts/regtest.sh wallet

addresses:
	@cd $(ROOT) && WALLET="$(WALLET)" ./scripts/regtest.sh addresses

fund:
	@cd $(ROOT) && WALLET="$(WALLET)" ./scripts/regtest.sh fund "$(ADDR)" "$(or $(AMOUNT),0.0005)"

mine:
	@cd $(ROOT) && WALLET="$(WALLET)" ./scripts/regtest.sh mine "$(or $(N),1)"

btc:
	@cd $(ROOT) && WALLET="$(WALLET)" ./scripts/regtest.sh cli "$(METHOD)" '$(or $(PARAMS),[])'

# Pass flags with ARGS, e.g. make tui ARGS="--recovery ~/Downloads/opendeal-encrypted-demo.json"
tui:
	cd $(ROOT) && cargo run -q -p opendeal-tui -- $(ARGS)

install-frontend:
	cd $(ROOT)/frontend && pnpm install

build: build-api build-frontend

build-api:
	cd $(ROOT) && cargo build --release -p opendeal-api

build-frontend:
	cd $(ROOT)/frontend && pnpm build

e2e:
	cd $(ROOT) && ./scripts/live-regtest-e2e.sh

e2e-offline:
	cd $(ROOT) && cargo run -p regtest-demo -- laptop-sale

check:
	cd $(ROOT) && cargo check --workspace

test:
	cd $(ROOT) && cargo test -p opendeal-core -p opendeal-bitcoin -p opendeal-tui

test-tui:
	cd $(ROOT) && cargo test -p opendeal-tui
