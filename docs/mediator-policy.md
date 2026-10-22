# Mediator policy and support runbook

Status: Phase 2 pilot policy for human mediators on OpenDeal multisig deals. Not a legal opinion.

## Role

The mediator is a pre-agreed third pubkey on the 2-of-3 escrow. They:

- Help resolve disputes when buyer and seller disagree
- Record a decision (`release` or `refund`) with rationale in the API
- May co-sign a settlement PSBT with exactly one other party

They cannot spend escrow alone. A mediator decision updates protocol state; Bitcoin still requires two signatures.

## Who may mediate (pilot)

- Pubkeys listed in `MEDIATOR_PUBKEYS` (required in production)
- Deal creation must use one of those pubkeys as `mediator_pubkey` for production pilots
- Mediators are known operators, not anonymous volunteers, during the constrained pilot

## Informal SLA (pilot)

| Situation | Target response |
| --- | --- |
| New dispute opened | Acknowledge within **2 business days** |
| Evidence complete from both sides | Decision within **5 business days** |
| Funded deal, party unresponsive after soft timeout | Start recovery outreach within **3 business days** |

These are operational targets for the pilot, not contractual SLAs.

## Formal dispute timing (Phase 4)

Written targets for operators who depend on this desk. Still not a statute or a damages clause.

| Clock | Target |
| --- | --- |
| Acknowledge a new dispute | 2 business days |
| Decide once both sides have uploaded evidence | 5 business days |
| Start recovery outreach on a funded, unresponsive deal | 3 business days |
| Escalation if a target is missed | Pilot operator lead the next business day |

Missed targets are recorded on the dispute notes. They do not move bitcoin by themselves. Settlement still needs a reviewed 2-of-3 PSBT, or a provider release/refund when the rail is custodial.

## Evidence expectations

Acceptable evidence is whatever the agreement implies, typically:

- Photos or tracking references (shipping)
- Chat exports agreeing to terms or delivery events
- On-chain funding / settlement txids already on the deal

Rules:

- Evidence is timestamped and linked to the deal; it does not automatically prove authenticity or condition of goods
- Prefer structured uploads via the evidence API (text or object storage)
- Allegations without evidence should not alone force a payout against the other party

## Decision guide

| Finding | Decision | Settlement purpose |
| --- | --- | --- |
| Delivery met acceptance conditions | `release` | `payout_seller` |
| Non-delivery, material breach, or agreed cancel after fund | `refund` | `refund_buyer` |
| Insufficient evidence / unclear | Ask for more evidence; do not decide yet | — |
| Both unresponsive after outreach | Prefer `refund_buyer` for funded deals unless agreement says otherwise; document why | `refund_buyer` |

Always write a short rationale in the resolve call. Bias toward the written agreement terms over informal chat when they conflict.

## Support runbook (operator steps)

### A. Dispute opened

1. Load deal + timeline + evidence in the mediator desk / API.
2. Confirm status is `disputed` and you are the deal’s `mediator_pubkey`.
3. Message both parties (email / agreed channel) with what evidence is missing and a deadline (for example 72 hours).
4. When ready: `POST /api/v1/disputes/{id}/resolve` with `release` or `refund` and rationale.
5. Tell parties which PSBT purpose to expect next; remind them the decision does not broadcast Bitcoin.

### B. Settlement after decision

1. Receiving party provides a destination address they control.
2. Propose settlement with policy-valid fee (`FeeDustPolicy`).
3. Mediator + winning party (or buyer+seller if they agree) sign off-server.
4. Finalize/broadcast; verify receipt offline.
5. If a party will not sign after a valid decision, escalate using [`recovery.md`](./recovery.md).

### C. Funded but no dispute (ghost party)

1. Confirm funding on-chain.
2. Attempt contact for **3 business days**.
3. Open or continue a dispute if policy requires a recorded decision.
4. Follow manual recovery in [`recovery.md`](./recovery.md).

### D. Suspected fraud / abuse

1. Pause mediation; do not co-sign.
2. Preserve receipt, evidence, and webhook logs.
3. Cap further deals for those pubkeys at the product layer if a kill switch exists.
4. Escalate to the pilot operator lead.

## What mediators must not do

- Ask parties to paste seed phrases or private keys into chat, tickets, or the API
- Promise “guaranteed” delivery outcomes the software cannot verify
- Sign a PSBT they have not reviewed (outputs, fee, purpose)
- Imply Lightning/fiat rails have the same guarantees as multisig

## Related docs

- [`protocol.md`](./protocol.md) — agreement, statuses, settlement flow
- [`recovery.md`](./recovery.md) — stuck-fund recovery
- [`threat-model.md`](./threat-model.md) — residual collusion risk
- [`deploy.md`](./deploy.md) — production env gates including `MEDIATOR_PUBKEYS`
