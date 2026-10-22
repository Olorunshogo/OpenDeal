use serde_json::{Value, json};
use utoipa::OpenApi;

pub struct ApiDoc;

/// Describes the actual routes; protected operations all require the same JWT.
/// Request examples are also used to derive explicit object schemas for Swagger.
impl OpenApi for ApiDoc {
    fn openapi() -> utoipa::openapi::OpenApi {
        let mut paths = serde_json::Map::new();
        for (method, path, summary, request, response) in operations() {
            let public = path.starts_with("/health") || path.starts_with("/api/v1/auth/") || path == "/api/v1/meta" || path.starts_with("/api/v1/deals/reputation/");
            let mut operation = json!({
                "summary":summary,
                "operationId":format!("{}_{}",method,path.replace('/',"_").replace(['{','}'],"")),
                "security": if public { json!([]) } else { json!([{"bearerAuth":[]}]) },
                "responses":{
                    "200":{"description":"Success","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Envelope"},"example":{"message":"ok","success":true,"data":response}}}},
                    "400":{"description":"Invalid input or Bitcoin validation failure","content":{"application/json":{"schema":{"$ref":"#/components/schemas/Error"}}}},
                    "401":{"description":"Missing, invalid or expired authentication"},
                    "403":{"description":"Identity is not authorized for this deal/operation"},
                    "404":{"description":"Resource not found"},
                    "409":{"description":"Invalid state, immutable proposal or uncertain broadcast; inspect code"},
                    "422":{"description":"Malformed JSON, unknown fields or invalid field types"}
                }
            });
            if path.contains("{id}") {
                operation["parameters"] = json!([{"name":"id","in":"path","required":true,"schema":{"type":"string"},"description":"Agreement SHA256 hex, or dispute UUID on /disputes routes"}]);
            }
            if method == "post" && !request.is_null() {
                operation["requestBody"] = json!({"required":true,"content":{"application/json":{"schema":schema(&request),"example":request}}});
            }
            if path == "/api/v1/deals" && method == "post" {
                operation["requestBody"]["content"]["application/json"]["schema"]["required"] =
                    json!([
                        "title",
                        "amount_sats",
                        "buyer_pubkey",
                        "mediator_pubkey",
                        "delivery_deadline",
                        "acceptance_window_hours"
                    ]);

                operation["parameters"] = json!([{"name":"Idempotency-Key","in":"header","required":false,"schema":{"type":"string","maxLength":128},"description":"Actor-scoped create retry key. Same key and body returns the same deal; changed body conflicts."}]);
            }
            if path.ends_with("/settlement/confirm") {
                operation["requestBody"]["content"]["application/json"]["schema"]["required"] =
                    json!([]);
            }
            if path.contains("{pubkey}") { operation["parameters"]=json!([{"name":"pubkey","in":"path","required":true,"schema":{"type":"string"}}]); }
            if path.contains("{evidence_id}") { operation["parameters"].as_array_mut().expect("id parameter").push(json!({"name":"evidence_id","in":"path","required":true,"schema":{"type":"string","format":"uuid"}})); }
            if path.ends_with("/content") { operation["responses"]["200"]=json!({"description":"Attachment","content":{"application/octet-stream":{"schema":{"type":"string","format":"binary"}}}}); }
            if path.starts_with("/health") {
                operation["responses"]["200"] = json!({"description":summary,"content":{"text/plain":{"schema":{"type":"string"},"example":if path.ends_with("ready") {"ready"} else {"ok"}}}});
                if path.ends_with("ready") {
                    operation["responses"]["503"] = json!({"description":"PostgreSQL unavailable"});
                }
            }
            paths.entry(path.to_owned()).or_insert_with(|| json!({}))[method] = operation;
        }
        serde_json::from_value(json!({
            "openapi":"3.1.0","info":{"title":"OpenDeal API","version":"0.2.0","description":"Non-custodial deal coordination. Broadcast is not confirmation. See docs/frontend-api-integration.md for signed canonical terms and role/state policies."},
            "paths":paths,
            "components":{"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer","bearerFormat":"JWT"}},"schemas":{
                "Envelope":{"type":"object","required":["message","success","data"],"properties":{"message":{"type":"string"},"success":{"type":"boolean"},"data":{"type":["object","array","string","number","boolean","null"]}}},
                "Error":{"type":"object","required":["message","success"],"properties":{"message":{"type":"string"},"success":{"type":"boolean","const":false},"code":{"type":["string","null"]}}}
            }}
        })).expect("valid static OpenAPI contract")
    }
}

fn schema(example: &Value) -> Value {
    match example {
        Value::Object(fields) => {
            json!({"type":"object","additionalProperties":false,"required":fields.keys().collect::<Vec<_>>(),"properties":fields.iter().map(|(key,value)|(key.clone(),schema(value))).collect::<serde_json::Map<_,_>>()})
        }
        Value::Array(_) => {
            json!({"type":"array","items":{"type":["object","array","string","number","boolean","null"]}})
        }
        Value::Number(_) => json!({"type":"integer","minimum":0}),
        Value::Bool(_) => json!({"type":"boolean"}),
        _ => json!({"type":"string"}),
    }
}

fn operations() -> Vec<(&'static str, &'static str, &'static str, Value, Value)> {
    let deal = json!({"id":"<agreement-sha256>","status":"draft","amount_sats":100000,"network":"regtest","settlement_phase":"none","settlement_txid":null,"settlement_confirmations":0,"current_psbt":null});
    vec![
        ("get","/api/v1/meta","Public deployment network and custody metadata",Value::Null,json!({"network":"regtest"})),
        ("post","/api/v1/auth/dev/session","Development-only session helper; disabled in production",json!({"pubkey":"<xonly>"}),json!({"token":"<JWT>"})),
        ("get","/api/v1/deals/reputation/{pubkey}","Public aggregate reputation",Value::Null,json!({"settled":0})),
        ("get","/api/v1/disputes","List disputes assigned to this configured mediator",Value::Null,json!([])),
        ("get","/api/v1/deals/{id}/evidence/{evidence_id}/content","Download private evidence as an attachment",Value::Null,json!("<bytes>")),

        (
            "get",
            "/health",
            "Process liveness",
            Value::Null,
            json!("ok"),
        ),
        (
            "get",
            "/health/ready",
            "PostgreSQL readiness (does not probe Bitcoin)",
            Value::Null,
            json!("ready"),
        ),
        (
            "post",
            "/api/v1/auth/nostr/challenge",
            "Issue single-use Nostr challenge",
            json!({"pubkey":"<64-hex-xonly-key>"}),
            json!({"nonce":"<uuid>","expires_at":"2026-12-01T00:05:00Z"}),
        ),
        (
            "post",
            "/api/v1/auth/nostr/login",
            "Verify kind-22242 signed nonce and issue JWT",
            json!({"event":{"id":"<event-id>","pubkey":"<xonly>","created_at":1796083200,"kind":22242,"tags":[],"content":"<nonce>","sig":"<schnorr-signature>"}}),
            json!({"token":"<JWT>","pubkey":"<xonly>"}),
        ),
        (
            "post",
            "/api/v1/deals",
            "Create draft as authenticated seller",
            json!({"title":"Laptop","description":"Used laptop","amount_sats":100000,"seller_pubkey":"<seller-xonly>","buyer_pubkey":"<buyer-xonly>","mediator_pubkey":"<mediator-xonly>","delivery_deadline":"2026-12-01T00:00:00Z","acceptance_window_hours":24,"currency":"BTC","network":"regtest","settlement_model":"bitcoin_multisig_2of3","seller_payout_address":"<bcrt1-address>","buyer_refund_address":"<bcrt1-address>"}),
            deal.clone(),
        ),
        (
            "get",
            "/api/v1/deals/{id}",
            "Read participant's deal",
            Value::Null,
            deal.clone(),
        ),
        (
            "get",
            "/api/v1/deals/{id}/agreement",
            "Read canonical signed agreement terms",
            Value::Null,
            json!({"version":1,"title":"Laptop","amount_sats":100000,"network":"regtest"}),
        ),
        (
            "post",
            "/api/v1/deals/{id}/sign",
            "Verify buyer or seller compact ECDSA agreement signature",
            json!({"signature":{"sig":"<64-byte-compact-signature-hex>","pubkey":"<33-byte-compressed-pubkey-hex>"}}),
            deal.clone(),
        ),
        (
            "post",
            "/api/v1/deals/{id}/transition",
            "Seller ships, buyer accepts, or unfunded parties cancel",
            json!({"to":"shipped"}),
            deal.clone(),
        ),
        (
            "post",
            "/api/v1/deals/{id}/funding/prepare",
            "Prepare agreed multisig escrow",
            Value::Null,
            deal.clone(),
        ),
        (
            "get",
            "/api/v1/deals/{id}/funding",
            "Return escrow scripts, address and confirmation policy",
            Value::Null,
            json!({"address":"<bcrt1-escrow>","script_pubkey_hex":"<hex>","witness_script_hex":"<hex>","expected_amount_sats":100000,"required_confirmations":1,"network":"regtest","settlement_model":"bitcoin_multisig_2of3"}),
        ),
        (
            "post",
            "/api/v1/deals/{id}/funding/verify",
            "Observe unclaimed escrow UTXO from Core",
            Value::Null,
            deal.clone(),
        ),
        (
            "post",
            "/api/v1/deals/{id}/settlement/propose",
            "Freeze authorized payout/refund PSBT",
            json!({"destination_address":"<signed-bcrt1-destination>","fee_sats":1000,"purpose":"payout_seller"}),
            deal.clone(),
        ),
        (
            "get",
            "/api/v1/deals/{id}/settlement",
            "Retrieve PSBT and verified signing/chain progress",
            Value::Null,
            json!({"current_psbt":"<base64>","valid_signatures":1,"required_signatures":2,"phase":"proposed","txid":null,"confirmations":0,"block_hash":null,"purpose":"payout_seller"}),
        ),
        (
            "post",
            "/api/v1/deals/{id}/settlement/sign",
            "Verify and combine external partial signatures",
            json!({"signed_psbt":"<base64-PSBT>"}),
            deal.clone(),
        ),
        (
            "post",
            "/api/v1/deals/{id}/settlement/finalize",
            "Validate, finalize witness and attempt broadcast once",
            Value::Null,
            deal.clone(),
        ),
        (
            "post",
            "/api/v1/deals/{id}/settlement/confirm",
            "Reconcile confirmations or reorganization; block hash optional with txindex",
            json!({"block_hash":"<block-hash-hex>"}),
            deal.clone(),
        ),
        (
            "get",
            "/api/v1/deals/{id}/events",
            "Read ordered hash-chained participant event history",
            Value::Null,
            json!([]),
        ),
        (
            "get",
            "/api/v1/deals/{id}/receipt",
            "Export independently checkable receipt",
            Value::Null,
            json!({"agreement":{},"agreement_id":"<id>","status":"accepted","events":[],"agreement_signatures":[],"funding_txid":"<txid>","settlement_txid":null}),
        ),
        (
            "post",
            "/api/v1/deals/{id}/evidence",
            "Buyer/seller submit evidence and SHA256 hash",
            json!({"kind":"text","content":"Item not delivered"}),
            json!({"id":"<uuid>","content_sha256":"<sha256>","kind":"text","content":"Item not delivered"}),
        ),
        (
            "get",
            "/api/v1/deals/{id}/evidence",
            "Read private evidence as a participant",
            Value::Null,
            json!([]),
        ),
        (
            "post",
            "/api/v1/deals/{id}/disputes",
            "Buyer/seller open dispute on funded/shipped/accepted deal",
            json!({"reason":"Item not delivered"}),
            json!({"id":"<uuid>","status":"open"}),
        ),
        (
            "get",
            "/api/v1/disputes/{id}",
            "Read dispute as a deal participant",
            Value::Null,
            json!({"id":"<uuid>","status":"open"}),
        ),
        (
            "post",
            "/api/v1/disputes/{id}/resolve",
            "Deal mediator records release/refund authorization; does not settle funds",
            json!({"decision":"refund","rationale":"Delivery not substantiated"}),
            json!({"id":"<uuid>","status":"resolved","decision":"refund"}),
        ),
        (
            "post",
            "/api/v1/webhooks",
            "Register HTTPS webhook (transactional outbox; delivery worker not included)",
            json!({"url":"https://merchant.example/hooks"}),
            json!({"id":"<uuid>","url":"https://merchant.example/hooks","secret":"<owner-webhook-secret>"}),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn documents_actual_operations_and_bearer_security() {
        let document = serde_json::to_value(ApiDoc::openapi()).unwrap();
        assert!(document["paths"].as_object().unwrap().len() >= 20);
        assert_eq!(
            document["paths"]["/api/v1/deals/{id}/settlement/confirm"]["post"]["security"][0]["bearerAuth"],
            json!([])
        );
        assert!(
            document["paths"]["/api/v1/auth/nostr/challenge"]["post"]["security"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
}
