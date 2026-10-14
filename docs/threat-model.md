# OpenDeal Threat Model

Status: living document for the MVP and early pilots. Not a security audit.

## Assets

- Party private keys (must never touch the OpenDeal API or database)
- Escrow UTXOs locked in 2-of-3 P2WSH
- Signed agreements and event chains (integrity / non-repudiation)
- Mediator decisions and dispute evidence
- Session JWTs and webhook secrets

## Trust boundaries

| Component | Trust assumption |
| --- | --- |
| `opendeal-api` | Coordinates state. Must not store seed phrases or private keys. |
| Participant wallets | Hold keys. Sign agreements and PSBTs. |
| Mediator | Assists deadlock resolution. Cannot spend alone. |
| Bitcoin network | Provides settlement finality after confirmations. |
| Lightning/fiat adapters | Introduce provider custody. Labeled honestly in the UI. |

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| API unilaterally releases funds | Multisig adapter has no unilateral spend. Mediator cannot broadcast alone. |
| Fake “funded” state from invoice creation | Funding requires script, amount, and N confirmations. |
| Illegal status transitions from clients | Server-side `DealStatus::allowed_next` |
| Event history tampering | Hash-chained events. Offline receipt verification. |
| Replay / duplicate settlement | Idempotency-Key on funding/settlement mutations. Unique event sequences. |
| Webhook spoofing | HMAC signature header `X-OpenDeal-Signature` |
| Mainnet accidental use | `OPENDEAL_ALLOW_MAINNET` gate. MVP labeled regtest experimental. |
| Mediator collusion with one party | Documented residual risk. 2-of-3 still requires a second signature. |
| Frozen funds / non-cooperation | Timelock recovery deferred. Document manual recovery as future work. |
| Simulated adapter in production | Startup refused when `APP_ENV=production` and model is `simulated` |

## Explicit non-goals (MVP)

- Trustless determination of physical-world delivery quality
- AI dispute adjudication
- Automated timelock recovery paths
- Handling real user funds without an external review

## Residual risks

- Mediator plus one party can always settle against the other
- If all three refuse to sign, funds remain locked until a recovery path exists
- Lightning/fiat rails reintroduce custody. The product must never imply multisig guarantees for those models.
