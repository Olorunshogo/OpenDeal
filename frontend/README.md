# OpenDeal frontend

Next.js App Router UI for buyer, seller, and mediator deal flows.

```bash
cp .env.local.example .env.local
pnpm install
pnpm dev
```

Paste a JWT from `POST /api/v1/auth/nostr/login` into the session bar to act as a party. All mutating routes require that Bearer token.

Labeled **regtest experimental** in the UI. That label never implies mainnet or custodial release for multisig deals.
