use utoipa::OpenApi;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "OpenDeal API",
        version = "0.1.0",
        description = "Bitcoin-native commerce coordination protocol. The API never holds private keys."
    ),
    paths(
        health_live,
        health_ready,
        public_meta,
        auth_nostr_challenge,
        auth_nostr_login,
        auth_dev_session,
        deals_create,
        deals_get,
        deals_agreement,
        deals_sign,
        deals_transition,
        deals_funding_prepare,
        deals_funding_verify,
        deals_settlement_propose,
        deals_settlement_sign,
        deals_settlement_finalize,
        deals_events,
        deals_receipt,
        deals_reputation,
        evidence_submit,
        evidence_list,
        evidence_download,
        disputes_open,
        disputes_list,
        disputes_get,
        disputes_resolve,
        webhooks_register,
    ),
    tags(
        (name = "health", description = "Liveness and readiness"),
        (name = "auth", description = "Nostr and development authentication"),
        (name = "deals", description = "Deal lifecycle, funding, settlement"),
        (name = "evidence", description = "Deal evidence uploads"),
        (name = "disputes", description = "Structured disputes"),
        (name = "webhooks", description = "Signed outbound webhooks"),
    )
)]
pub struct ApiDoc;

#[allow(dead_code)]
#[utoipa::path(get, path = "/health", tag = "health", responses((status = 200, description = "ok")))]
fn health_live() {}

#[allow(dead_code)]
#[utoipa::path(get, path = "/health/ready", tag = "health", responses((status = 200, description = "ready")))]
fn health_ready() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/meta",
    tag = "health",
    responses((status = 200, description = "Public network and pilot metadata"))
)]
fn public_meta() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/auth/nostr/challenge",
    tag = "auth",
    request_body = inline(NostrChallengeBody),
    responses((status = 200, description = "challenge issued"))
)]
fn auth_nostr_challenge() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/auth/nostr/login",
    tag = "auth",
    request_body = inline(NostrLoginBody),
    responses((status = 200, description = "JWT issued"))
)]
fn auth_nostr_login() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/auth/dev/session",
    tag = "auth",
    request_body = inline(DevSessionBody),
    responses(
        (status = 200, description = "dev JWT issued"),
        (status = 403, description = "disabled in production")
    )
)]
fn auth_dev_session() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals",
    tag = "deals",
    request_body = inline(CreateDealBody),
    responses((status = 200, description = "deal created"))
)]
fn deals_create() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/deals/{id}",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    responses((status = 200, description = "deal"))
)]
fn deals_get() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/deals/{id}/agreement",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    responses((status = 200, description = "agreement + canonical_hex + signed_pubkeys"))
)]
fn deals_agreement() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals/{id}/sign",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    request_body = inline(SignBody),
    responses((status = 200, description = "agreement signed"))
)]
fn deals_sign() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals/{id}/transition",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    request_body = inline(TransitionBody),
    responses((status = 200, description = "status updated"))
)]
fn deals_transition() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals/{id}/funding/prepare",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    responses((status = 200, description = "escrow prepared"))
)]
fn deals_funding_prepare() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals/{id}/funding/verify",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    responses((status = 200, description = "funding status"))
)]
fn deals_funding_verify() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals/{id}/settlement/propose",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    request_body = inline(ProposeSettlementBody),
    responses((status = 200, description = "PSBT proposed"))
)]
fn deals_settlement_propose() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals/{id}/settlement/sign",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    request_body = inline(AttachPsbtBody),
    responses((status = 200, description = "PSBT combined"))
)]
fn deals_settlement_sign() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals/{id}/settlement/finalize",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    responses((status = 200, description = "broadcast"))
)]
fn deals_settlement_finalize() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/deals/reputation/{pubkey}",
    tag = "deals",
    responses((status = 200, description = "Counts from verified deal rows"))
)]
fn deals_reputation() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/deals/{id}/events",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    responses((status = 200, description = "event chain"))
)]
fn deals_events() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/deals/{id}/receipt",
    tag = "deals",
    params(("id" = String, Path, description = "deal id")),
    responses((status = 200, description = "verifiable receipt"))
)]
fn deals_receipt() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals/{id}/evidence",
    tag = "evidence",
    params(("id" = String, Path, description = "deal id")),
    request_body = inline(EvidenceBody),
    responses((status = 200, description = "evidence recorded"))
)]
fn evidence_submit() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/deals/{id}/evidence",
    tag = "evidence",
    params(("id" = String, Path, description = "deal id")),
    responses((status = 200, description = "evidence list"))
)]
fn evidence_list() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/deals/{id}/evidence/{evidence_id}/content",
    tag = "evidence",
    params(
        ("id" = String, Path, description = "deal id"),
        ("evidence_id" = String, Path, description = "evidence id")
    ),
    responses((status = 200, description = "raw evidence bytes"))
)]
fn evidence_download() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/deals/{id}/disputes",
    tag = "disputes",
    params(("id" = String, Path, description = "deal id")),
    request_body = inline(DisputeBody),
    responses((status = 200, description = "dispute opened"))
)]
fn disputes_open() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/disputes",
    tag = "disputes",
    params(("status" = Option<String>, Query, description = "defaults to \"open\"")),
    responses((status = 200, description = "disputes for the signed-in mediator"))
)]
fn disputes_list() {}

#[allow(dead_code)]
#[utoipa::path(
    get,
    path = "/api/v1/disputes/{id}",
    tag = "disputes",
    params(("id" = String, Path, description = "dispute id")),
    responses((status = 200, description = "dispute"))
)]
fn disputes_get() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/disputes/{id}/resolve",
    tag = "disputes",
    params(("id" = String, Path, description = "dispute id")),
    request_body = inline(ResolveBody),
    responses((status = 200, description = "dispute resolved"))
)]
fn disputes_resolve() {}

#[allow(dead_code)]
#[utoipa::path(
    post,
    path = "/api/v1/webhooks",
    tag = "webhooks",
    request_body = inline(WebhookBody),
    responses((status = 200, description = "endpoint registered"))
)]
fn webhooks_register() {}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct NostrChallengeBody {
    pubkey: String,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct NostrLoginBody {
    event: serde_json::Value,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct DevSessionBody {
    pubkey: String,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct CreateDealBody {
    title: String,
    amount_sats: u64,
    buyer_pubkey: String,
    mediator_pubkey: String,
    delivery_deadline: String,
    acceptance_window_hours: u32,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct SignBody {
    signature: SignatureBody,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct SignatureBody {
    sig: String,
    pubkey: String,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct TransitionBody {
    to: String,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct ProposeSettlementBody {
    destination_address: String,
    fee_sats: u64,
    purpose: String,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct AttachPsbtBody {
    signed_psbt: String,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct EvidenceBody {
    kind: String,
    content: Option<String>,
    content_base64: Option<String>,
    content_type: Option<String>,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct DisputeBody {
    reason: String,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct ResolveBody {
    decision: String,
    rationale: String,
}

#[derive(utoipa::ToSchema, serde::Serialize)]
struct WebhookBody {
    url: String,
}
