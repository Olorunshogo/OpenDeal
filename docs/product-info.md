# SafeSale Protocol

Product idea #2: trust infrastructure for global peer-to-peer commerce.

A completely different direction from SatsFirewall. This tackles a familiar problem in Nigeria and many other markets: how can two strangers safely trade online when neither wants to trust the other with their money or goods first?

## Working name

SafeSale Protocol. Open-source transaction coordination for peer-to-peer commerce.

Imagine a buyer purchasing a used laptop from a seller they discovered on social media. The buyer worries the seller will disappear after payment. The seller worries the buyer will receive the laptop and refuse to pay. SafeSale coordinates the transaction, records the agreed terms, and provides a clear settlement process.

The long-term vision is not another marketplace. It's an integration layer that lets existing marketplaces add safer transactions without building their own escrow system from scratch.

One important discovery from the research: a project called SafeSale already exists as a hackathon submission focused on buyer/seller protection, Nostr identities, Lightning, and NGN payouts (GitHub). That makes a generic copy a poor choice, so this proposal differentiates itself as an open transaction protocol with pluggable settlement providers, verifiable transaction records, and a modular dispute-resolution system, not just another escrow website.

## 1. Product features

Organized around one transaction lifecycle, rather than a large collection of unrelated features.

### Feature 1: Shared deal agreements

Buyer or seller creates a deal containing the item or service, amount, currency, delivery deadline, acceptance conditions, and refund terms. Both parties approve the same version.

Global-standard goal: versioned, machine-readable transaction terms that other applications can reuse.

### Feature 2: Pluggable payment and settlement

Support Bitcoin Lightning first, with a payment-provider interface that can later support additional rails.

The interface must distinguish between a payment being requested, detected, confirmed, held, released, refunded, or disputed. Never treat a generated invoice as proof of payment.

Key innovation: one transaction workflow, multiple settlement implementations.

### Feature 3: Delivery and acceptance evidence

Sellers submit tracking information, photos, or a proof-of-delivery event. Buyers accept the delivery or open a dispute within the agreed time window.

Evidence is timestamped and linked to the deal. The system does not automatically assume a photo or tracking event proves the item is genuine or undamaged.

### Feature 4: Structured dispute resolution

Either party can raise a dispute, submit evidence, respond to the other party, and request a mediator decision. Every decision records its rationale and resulting settlement action.

For the prototype, use a clearly disclosed human mediator. Do not pretend the software can objectively determine the truth of every dispute.

### Feature 5: Portable identity and reputation

Let users identify themselves with Nostr public keys and build a history of completed deals, cancelled deals, and resolved disputes.

Reputation should be based on verifiable transaction events, not merely self-reported star ratings. Keep allegations distinct from proven outcomes, and provide ways to challenge incorrect records.

### Feature 6: Developer API and embeddable checkout

An existing marketplace can create a deal through an API, redirect the buyer to a hosted transaction page, receive signed webhooks, and display the final outcome in its own application.

This is the feature that turns SafeSale from a standalone website into potential infrastructure.

## 2. Recommended tech stack

Rust + Axum + PostgreSQL on the backend, and Next.js + TypeScript on the frontend. Not both Vue and React, or Axum and Actix. Choose one framework per layer so you can ship faster and spend more time on the product itself.

### Frontend: Next.js + React + TypeScript (recommended)

- Next.js App Router
- Tailwind CSS and shadcn/ui
- TanStack Query for server state
- React Hook Form + Zod for forms and validation
- WebSocket or Server-Sent Events for live order updates

Why: React has a broad ecosystem, Next.js supports a polished public-facing experience, and typed API contracts make it easier to coordinate with the Rust backend.

### Backend: Rust + Axum (recommended)

- Axum for HTTP APIs and webhooks
- Tokio for asynchronous work
- SQLx for PostgreSQL access
- Serde for serialization
- Tower middleware for timeouts, tracing, and request controls
- OpenAPI documentation for external integrators

Why Axum over Actix Web? The Tokio/Tower ecosystem and straightforward composition. Actix Web is also a solid production option; no need to switch if you already know it well.

### Data: PostgreSQL

- PostgreSQL as the source of truth
- SQLx migrations and transaction support
- Append-only audit events for important state changes
- Redis only if background queues, rate limiting, or caching actually require it

Important: database transactions and idempotency keys must prevent duplicate releases, refunds, and webhook processing.

### Security and operations

- Secrets manager or protected environment secrets
- Signed webhooks with replay protection
- OpenTelemetry for traces and metrics
- Sentry for frontend/backend error monitoring
- GitHub Actions for tests, linting, and CI
- Docker for reproducible local development

### Why not Nuxt or Vue?

Nuxt + Vue 3 + TypeScript would also work well, if significantly faster with Vue. The backend architecture remains the same. For this product, team speed, reliable settlement handling, and the quality of the live demo matter more than which frontend framework is theoretically best.

## 3. Third-party integrations: what to use and why

Keep the integration surface small initially. Every payment provider introduces additional operational, security, and potentially regulatory complexity.

| Integration | Recommendation | Purpose |
| --- | --- | --- |
| Nostr | nostr-sdk for Rust or nostr-tools for TypeScript | Public-key identity, signed events, and optional decentralized discovery |
| NWC | Compatible wallet connection, subject to supported methods | Lightning payment requests and status checks |
| BTCPay Server | Optional integration | Merchant payment processing and invoice tracking |
| MavaPay | Investigate for an NGN settlement pilot | Potential naira pay-ins and payouts; verify current API access, coverage, fees, and legal requirements first |
| Cloudflare R2 | Recommended | Store delivery evidence and attachments |
| Resend | Recommended | Deal invitations, receipts, dispute notifications |
| OpenTelemetry | Recommended | Monitor transaction latency, failures, and webhook delivery |

Nostr and Lightning are relevant to the original hackathon's ecosystem. The MavaPay integration is a candidate to investigate, not a confirmed commitment or guaranteed available service. A prior SafeSale project describes a similar NGN/BTC integration, so its implementation is worth studying before choosing a provider.

Useful technical references: Axum documentation, SQLx documentation, Nostr protocol specifications, NWC specification, BTCPay Server documentation, OpenTelemetry documentation.

### What not to integrate yet

- Multiple fiat payment providers.
- AI-based automatic dispute adjudication.
- A custom Lightning node and routing infrastructure unless a specific feature requires it.
- On-chain multisig, Lightning hold invoices, and third-party custody all at once.
- A token or proprietary cryptocurrency.

Each adds complexity before the core transaction lifecycle has been validated.

## 4. Architecture: how the pieces fit together

- Next.js web application. Buyer, seller, mediator
- Rust / Axum API. Authentication, authorization, deal state machine, idempotency
- PostgreSQL. Deals, state, evidence metadata, audit trail
- Job worker. Expiry checks, notifications, retries
- Payment adapter. Test adapter first, then supported Lightning/provider API
- Evidence & events. Object storage, signed events, notifications

The critical design decision is the transaction state machine:

```
draft -> agreed -> awaiting_payment -> funded -> shipped -> accepted -> settled
```

Alternative paths include cancelled, disputed, refunded, and expired. The state machine must reject illegal transitions. A seller must not be able to mark a transaction settled simply by changing a frontend value.

### The settlement caveat you must get right

An ordinary Lightning invoice is not a general-purpose escrow contract. Receiving a payment does not automatically mean the funds can be held and refunded under arbitrary rules.

For a hackathon prototype, use a simulated payment adapter first, then integrate a supported real payment flow. For a real-money pilot, select a settlement model only after carefully reviewing its trust assumptions, refund behavior, custody implications, and jurisdictional requirements.

A 2-of-2 multisignature arrangement requires cooperation from both parties to spend, while a 2-of-3 arrangement adds an arbiter who can help resolve deadlocks. Neither arrangement magically guarantees a fair outcome. Hold invoices have their own constraints and are not universally supported.

That distinction should be visible in the product: users must know whether a transaction is simulated, provider-managed, custodial, or governed by a specific multisignature arrangement.

## 5. Is this achievable?

Yes. A convincing prototype is achievable for a small team. A production-grade, global escrow network is a much larger undertaking.

### Hackathon MVP (achievable)

Estimated 2-4 days for an experienced 2-3 person team, assuming the payment integration is mocked or already accessible.

- Create and accept a deal.
- Display the transaction state.
- Simulate funding, delivery, acceptance, and refunds.
- Provide a dispute workflow with a mediator dashboard.
- Generate a verifiable event history.
- Demonstrate a marketplace creating deals through the API.

### Real Lightning pilot

Estimated 2-6 additional weeks, depending on the settlement model, provider access, and team experience. Add a real compatible payment integration, verified payment notifications, secure credential handling, idempotent settlement processing, and tested failure recovery.

### Production service

A multi-month effort at minimum, potentially longer if the product directly handles customer funds. Requires security reviews, operational monitoring, provider redundancy, dispute policies, compliance assessment, support processes, and evidence that real merchants want to integrate it.

These are engineering estimates, not guarantees. A solo developer who is learning Rust and Lightning simultaneously should allow considerably more time.

## 6. What would make the judges remember it?

Build the demonstration around a single laptop sale:

1. A seller creates a deal for a laptop and sets the agreed price, delivery deadline, and acceptance rules.
2. The buyer opens a shareable link, reviews the terms, and accepts them.
3. The system registers the funding event using a clearly identified test payment or supported real payment.
4. The seller submits delivery evidence. The buyer reports that the package arrived damaged.
5. The mediator reviews the evidence, records a decision, and triggers the appropriate simulated settlement action.
6. Finally, show how a second marketplace could reuse the same transaction API instead of implementing its own deal lifecycle.

The last step is the business story: one safe transaction engine, reusable by many marketplaces.

Failure cases to test before the presentation:

- Duplicate payment webhooks must not create duplicate settlements.
- Expired deals must not accept new funding without an explicit policy allowing it.
- Unauthorized users must not be able to release funds.
- A mediator decision must be auditable.
- A provider timeout must not be misreported as a failed payment if the actual payment status is unknown.

A judge who sees the happy path and at least one carefully handled failure is seeing more than a mock-up.

## 7. The final decision

Between SatsFirewall and SafeSale Protocol:

| | SatsFirewall | SafeSale Protocol |
| --- | --- | --- |
| Main problem | Uncontrolled software spending | Unsafe transactions between strangers |
| Best technical demonstration | A payment is blocked by policy | A complete deal moves through dispute and settlement |
| Strongest audience | Bitcoin infrastructure developers | Payments, commerce, and marketplace builders |
| Hardest problem | Secure enforcement across wallet connections | Trustworthy settlement and dispute resolution |
| Startup potential | Developer infrastructure | Marketplace infrastructure |

Preference leans SafeSale Protocol for its immediately understandable user problem, provided it's clearly differentiated from existing escrow projects and the prototype never claims trustless escrow when it does not offer that.

Before coding the whole platform: settle which competition you are targeting, what settlement model you can realistically demonstrate, and how this protocol differs from existing products such as SafeSale and Mostro. Mostro already has a functioning Nostr-based peer-to-peer exchange and dispute tooling, so the comparison matters.

---

## Current status (2026-10-12)

What exists so far, built per the stack above:

- **`crates/opendeal-api`** (current backend): Rust/Axum. Deal state machine, settlement adapters, evidence/disputes. See [`roadmap.md`](./roadmap.md).
- **`frontend/`**: Next.js (App Router) + TypeScript + Tailwind, TanStack Query, React Hook Form + Zod installed. A typed API client (`src/lib/api.ts`) mirrors the backend's `ApiEnvelope`/`ApiError`/`Deal`/`DealStatus` types by hand, so a drift between the two is a compile error on the frontend side, not a runtime surprise. One app, not separate buyer/seller/mediator apps. Role-based routing inside it instead, matching "one transaction workflow."
- **`docker-compose.yml`**: local Postgres only. Redis deliberately left out until something (rate limiting, queues, caching) actually needs it, per section 2's own guidance.
- Not started yet: auth/identity (Nostr pubkeys), delivery evidence, dispute resolution UI, reputation, the developer API/webhook surface, and any real payment provider.

## Strategy (phased)

1. **MVP (current phase)**: deal CRUD, the state machine, the simulated payment adapter, a basic dispute exit. Enough to demo one laptop sale end to end (section 6) with the payment path clearly labeled "simulated," per the settlement caveat in section 4. Never implying trustless escrow that isn't actually built.
2. **Real settlement pilot**: swap `LogPaymentProvider` for a real adapter behind the same `PaymentProvider` trait. No change to the deal state machine or handlers required. That is the point of the trait boundary existing now rather than later.
3. **Identity & reputation**: Nostr pubkey auth, reputation derived from the deal event history (section "Feature 5"), not self-reported ratings.
4. **Developer API / embeddable checkout**: the feature that makes this infrastructure rather than a site (section "Feature 6"): signed webhooks, a hosted checkout redirect, and a second demo "marketplace" integrating against the same API.
5. **Production hardening**: only once 1-4 show real demand: security review, compliance, provider redundancy, formal dispute policy.

Deliberately not doing yet, per section 3's "what not to integrate yet": multiple fiat rails, AI-driven dispute adjudication, a custom Lightning node, multisig/custody stacking, any token.

## Payment gateway options (for step 2, real settlement pilot)

All of the below offer free sandbox/test access with no upfront cost. Live traffic carries a small per-transaction fee; none of them charge just to sign up.

### Lightning/BTC rails (matches the stated direction)

- **NWC (Nostr Wallet Connect)**: not a gateway, a protocol. Zero cost, nothing to register for, but assumes the buyer/seller already has a compatible wallet (Alby, Mutiny, Zeus). Realistic for a crypto-native demo audience, not yet for a mainstream Nigerian buyer.
- **Bitnob**: Nigerian/Pan-African. Confirmed (community SDKs, not the official docs, which weren't reachable directly): a Lightning class with `create_invoice`/`pay_invoice`/`get_invoice`, API-key auth via an env var, and a sandbox mode (Python SDK: `BITNOB_PRODUCTION=false`; Ruby SDK defaults to sandbox unless told otherwise). Business-side payouts to NGN bank/mobile money are advertised on their business pages, but actual fees and KYB requirements were not published anywhere I could reach. That needs a direct signup or a sales conversation to confirm. ([Ruby SDK wiki](https://github.com/bitnob/bitnob_ruby_sdk/wiki), [PyPI](https://pypi.org/project/bitnob/))
- **MavaPay**: confirmed as real and live, not just a hackathon mention. Their own docs ([docs.mavapay.co](https://docs.mavapay.co/introduction)) list Lightning invoice acceptance, on-chain BTC, and payouts to bank accounts/mobile money, plus a "Payment Simulation" sandbox/staging mode with no real funds. NGN payouts specifically aren't spelled out on that page (it covers payouts generally, with a Nigerian-bank-account-validation endpoint as the strongest NGN signal). Fees and business verification are not published. The pricing page and compliance FAQ exist but weren't visible in this fetch; "Talk to Sales" (info@mavapay.co) is the stated route. Also notable: a secondary source ([Blink's guide](https://blink.sv/blog/how-to-withdraw-bitcoin-to-cash-in-africa-using-blink-and-mavapay-money-2026-guide)) says MavaPay runs on Blink's Lightning infrastructure, founded by a former Blink/Galoy engineer. Worth independently verifying, not confirmed by MavaPay's own site.
- **OpenNode**: international, not NGN-specific, clean REST API, free sandbox, roughly 1% fee live. Fallback if the Nigerian-specific rails are slow to onboard.
- **Voltage**: not a payment gateway; hosted Lightning node infrastructure (LND-as-a-service). Only relevant if a self-run node becomes necessary instead of a provider's API.

None of these provide "escrow" by themselves. A Lightning invoice only confirms a payment happened. Hold-and-release still has to be implemented on top, or via hold invoices (already flagged in section 4 as not universally supported).

**Upshot:** both Bitnob and MavaPay genuinely exist and have working Lightning APIs with a free sandbox. Neither one's actual fees or business (KYB) requirements are published anywhere crawlable. That's a "sign up or talk to sales" question for whoever actually integrates this, not something resolvable from documentation alone.

### Pure NGN fiat (no crypto)

- **Paystack / Flutterwave**: same-day sandbox keys, free until going live, then roughly 1.5% + a flat fee per transaction. Best-documented, Nigerian-origin, minimal friction. Doesn't match the Lightning-first story, but the fastest path to a real-money demo if the Bitcoin rails are slow to onboard.

### Recommendation

Don't block the MVP on any of this. The simulated `PaymentProvider` already lets the deal lifecycle work end to end. When ready for a real rail: apply for Bitnob sandbox access first, keep Paystack as the fast fallback for a real-money demo if Bitnob's KYB is slow, and treat MavaPay as a bonus rather than a dependency.

## Current status update (2026-10-12, later)

Added since the first status note above:

- **Audit event log** (`crates/opendeal-api`). Append-only deal events. Exposed as `GET /api/v1/deals/{id}/events`.
- **Evidence module**. `POST`/`GET /api/v1/deals/{id}/evidence`. Submitting evidence does not auto-transition deal status.
- **Disputes module**. `POST /api/v1/deals/{id}/disputes`; mediator resolve via `POST /api/v1/disputes/{id}/resolve` (`release` or `refund` + rationale).
- None of the new request bodies have real auth behind them yet. `actor`/`submitted_by`/`opened_by`/`mediator` are all self-declared strings from the caller. That's a known, documented gap until Nostr pubkey auth (Feature 5, strategy phase 3) exists; nothing here should be mistaken for a verified identity.
- Payment gateway research done (see above): Bitnob and MavaPay both confirmed real with working Lightning sandboxes; fees/KYB for both need a direct signup or sales conversation, not found in any public docs.

## What's next

Open items to pick from:
- Nostr-based auth (Feature 5). The biggest gap now that `actor`/`mediator`/etc. Are just unverified strings.
- Build out the frontend pages against the existing API client (deal creation form, deal detail/timeline view, mediator dashboard, dispute view).
- Sign up for Bitnob and/or MavaPay sandbox access directly to get real fee/KYB answers.
- Developer API / embeddable checkout (Feature 6). Signed webhooks and a hosted checkout redirect, once the core lifecycle above has a UI in front of it.
