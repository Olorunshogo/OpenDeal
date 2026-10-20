.PHONY: help up down logs ps api frontend install-frontend e2e e2e-offline migrate check test

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

help:
	@echo "OpenDeal local commands"
	@echo "  make up              Start Postgres + bitcoind (Docker)"
	@echo "  make down            Stop Compose services"
	@echo "  make logs            Tail Compose logs"
	@echo "  make ps              Compose status"
	@echo "  make api             Run API (loads migrations when RUN_MIGRATIONS=true)"
	@echo "  make frontend        Run Next.js dev server"
	@echo "  make install-frontend  pnpm install in frontend/"
	@echo "  make migrate         Same as make api (migrations run on API boot)"
	@echo "  make e2e             Live regtest e2e (API must already be up)"
	@echo "  make e2e-offline     Offline laptop-sale demo (no bitcoind)"
	@echo "  make check           cargo check workspace"
	@echo "  make test            cargo test core + bitcoin"

up:
	cd $(ROOT) && docker compose up -d
	@echo "Postgres host port: $$(cd $(ROOT) && docker compose port postgres 5432)"

down:
	cd $(ROOT) && docker compose down

logs:
	cd $(ROOT) && docker compose logs -f

ps:
	cd $(ROOT) && docker compose ps

api:
	cd $(ROOT) && cargo run -p opendeal-api

migrate: api

frontend:
	cd $(ROOT)/frontend && pnpm dev

install-frontend:
	cd $(ROOT)/frontend && pnpm install

e2e:
	cd $(ROOT) && ./scripts/live-regtest-e2e.sh

e2e-offline:
	cd $(ROOT) && cargo run -p regtest-demo -- laptop-sale

check:
	cd $(ROOT) && cargo check --workspace

test:
	cd $(ROOT) && cargo test -p opendeal-core -p opendeal-bitcoin
