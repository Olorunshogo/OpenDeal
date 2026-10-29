use crate::config::AppEnv;
use crate::settlement::MultisigSettlementAdapter;
use crate::{AppState, Config, build_app};
use axum::{Router, body::Body, http::Request};
use bitcoin::secp256k1::{Parity, PublicKey, Secp256k1, SecretKey, rand};
use bitcoin::{Address, Network};
use http_body_util::BodyExt;
use nostr::event::FinalizeEvent;
use opendeal_bitcoin::psbt::{psbt_from_base64, psbt_to_base64};
use opendeal_bitcoin::rpc::{TransactionStatus, UtxoInfo};
use opendeal_bitcoin::{BitcoinMultisigAdapter, MockBitcoinRpc};
use opendeal_core::{Agreement, DealReceipt, SettlementModel};
use serde_json::{Value, json};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use std::sync::Arc;
use std::time::Duration;
use tower::ServiceExt;

fn test_config() -> Config {
    Config {
        app_env: AppEnv::Test,
        port: 0,
        database_url: "postgres://localhost/opendeal_test".into(),
        database_admin_url: None,
        run_migrations: false,
        cors_allowed_origins: vec!["http://localhost:3000".into()],
        request_timeout: Duration::from_secs(120),
        max_body_bytes: 1024 * 1024,
        jwt_secret: "test-only-secret-with-at-least-32-bytes".into(),
        access_token_ttl: Duration::from_secs(3600),
        mediator_pubkeys: vec![],
        admin_pubkeys: vec![
            "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798".into(),
        ],
        demo_enabled: false,
        dev_session_enabled: false,
        settlement_model: SettlementModel::BitcoinMultisig2of3,
        bitcoin_rpc_url: None,
        bitcoin_rpc_user: None,
        bitcoin_rpc_password: None,
        bitcoin_required_confirmations: 1,
        bitcoin_max_fee_sats: 10_000,
        bitcoin_max_fee_bps: 1000,
        bitcoin_network: "regtest".into(),
        pilot_max_amount_sats: None,
        security_review_ack: false,
        allowed_pubkeys: vec![],
        bitcoin_rpc_fallback_url: None,
        rate_limit_per_minute: 10000,
        lightning_api_url: None,
        lightning_api_key: None,
        fiat_api_url: None,
        fiat_api_key: None,
        webhook_max_attempts: 8,
        webhook_retry_interval_secs: 15,
        evidence_dir: std::env::temp_dir().join("opendeal-test-evidence"),
        r2_bucket: None,
        r2_endpoint: None,
        r2_access_key_id: None,
        r2_secret_access_key: None,
        r2_region: "auto".into(),
        resend_api_key: None,
        email_from: None,
        otel_endpoint: None,
        sentry_dsn: None,
        allow_mainnet: false,
        webhook_signing_secret: "test-only-webhook-secret".into(),
    }
}

async fn mock_state(pool: sqlx::PgPool, mock: Arc<MockBitcoinRpc>) -> AppState {
    let adapter = MultisigSettlementAdapter::new(BitcoinMultisigAdapter::new(mock.clone(), 1));
    let mut config = test_config();
    // Existing disposable-database fixtures mint sessions through the opt-in dev route.
    config.dev_session_enabled = true;
    let storage = crate::storage::ObjectStorage::from_config(&config)
        .await
        .unwrap();
    let mut state = AppState::new(pool, config, Arc::new(adapter), storage);
    state.rpc = mock;
    state
}

#[tokio::test]
async fn private_routes_require_authentication() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/opendeal_test")
        .unwrap();
    let app = build_app(mock_state(pool, Arc::new(MockBitcoinRpc::new())).await);
    for path in [
        "/api/v1/deals/nope",
        "/api/v1/deals/nope/receipt",
        "/api/v1/deals/nope/events",
        "/api/v1/deals/nope/evidence",
        "/api/v1/deals/nope/agreement",
        "/api/v1/deals/nope/settlement",
        "/api/v1/disputes/00000000-0000-0000-0000-000000000000",
    ] {
        for token in [None, Some("Bearer invalid.jwt.token")] {
            let mut request = Request::builder().uri(path);
            if let Some(token) = token {
                request = request.header("Authorization", token);
            }
            let response = app
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), 401, "{path}");
        }
    }
    let contract =
        serde_json::to_value(<crate::openapi::ApiDoc as utoipa::OpenApi>::openapi()).unwrap();
    let mut protected_operations = 0;
    for (path, item) in contract["paths"].as_object().unwrap() {
        if !path.starts_with("/api/v1/")
            || path.starts_with("/api/v1/auth/")
            || path == "/api/v1/meta"
            || path.contains("/reputation/")
        {
            continue;
        }
        for (method, _) in item.as_object().unwrap() {
            if path == "/api/v1/mediators" && method == "get" {
                continue;
            }
            if !["get", "post"].contains(&method.as_str()) {
                continue;
            }
            protected_operations += 1;
            let uri = path
                .replace("{id}", "00000000-0000-0000-0000-000000000000")
                .replace("{evidence_id}", "00000000-0000-0000-0000-000000000000");
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(method.to_uppercase().as_str())
                        .uri(&uri)
                        .header("Content-Type", "application/json")
                        .body(Body::from("{}"))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                401,
                "documented route {method} {uri} must exist and require authentication"
            );
        }
    }
    assert_eq!(protected_operations, 30);
    let mut signature = json!({"sig":"00".repeat(64),"pubkey":"02".to_owned()+&"11".repeat(32)});
    signature["private_key"] = json!("forbidden-field");
    assert!(serde_json::from_value::<opendeal_core::Signature>(signature).is_err());
    for path in ["/health", "/api-docs/openapi.json"] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
    }
}

#[tokio::test]
async fn public_meta_publishes_configured_settlement_fee_limits() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/opendeal_test")
        .unwrap();
    let app = build_app(mock_state(pool, Arc::new(MockBitcoinRpc::new())).await);
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/meta")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["data"]["bitcoin_max_fee_sats"], 10_000);
    assert_eq!(value["data"]["bitcoin_max_fee_bps"], 1_000);
    assert_eq!(value["data"]["demo_enabled"], false);
}

#[test]
fn production_configuration_rejects_open_cors_and_bad_fee_policy() {
    let mut config = test_config();
    config.app_env = AppEnv::Production;
    config.cors_allowed_origins.clear();
    assert!(config.validate().is_err());
    config = test_config();
    config.bitcoin_max_fee_bps = 10_001;
    assert!(config.validate().is_err());
    config = test_config();
    config.bitcoin_network = "MAINNET".into();
    assert!(config.validate().is_err());
    config = test_config();
    config.app_env = AppEnv::Production;
    config.jwt_secret = "dev-jwt-secret-change-me-32chars!!".into();
    assert!(
        config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("production JWT_SECRET")
    );
}

struct Identity {
    secret: SecretKey,
    keys: nostr::key::Keys,
    public: String,
}
impl Identity {
    fn fresh() -> Self {
        let secp = Secp256k1::new();
        let mut secret = SecretKey::new(&mut rand::thread_rng());
        if PublicKey::from_secret_key(&secp, &secret)
            .x_only_public_key()
            .1
            == Parity::Odd
        {
            secret = secret.negate();
        }
        let keys = nostr::key::Keys::parse(&secret.display_secret().to_string()).unwrap();
        let public = keys.public_key().to_hex();
        Self {
            secret,
            keys,
            public,
        }
    }
    fn agreement_signature(&self, agreement: &Agreement) -> Value {
        let signature =
            opendeal_core::sign_bytes(&self.secret, &agreement.canonical_bytes().unwrap());
        opendeal_core::verify_agreement_signature(agreement, &signature).unwrap();
        json!({"signature":signature})
    }
}

struct Fixture {
    app: Router,
    pool: sqlx::PgPool,
    admin: sqlx::PgPool,
    database: String,
    mock: Arc<MockBitcoinRpc>,
}
impl Fixture {
    async fn new() -> Self {
        Self::new_with_migrator(crate::migrations::application_migrator().unwrap()).await
    }
    async fn new_with_migrator(migrator: sqlx::migrate::Migrator) -> Self {
        let _ = <crate::openapi::ApiDoc as utoipa::OpenApi>::openapi();
        let url = std::env::var("OPENDEAL_TEST_ADMIN_URL").expect(
            "export OPENDEAL_TEST_ADMIN_URL for a role allowed to create disposable databases",
        );
        let options: PgConnectOptions = url.parse().expect("valid test admin database URL");
        let admin = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(options.clone())
            .await
            .expect("connect test admin PostgreSQL");
        let database = format!("opendeal_test_{}", uuid::Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE DATABASE {database}"))
            .execute(&admin)
            .await
            .expect("create fresh disposable database (CREATEDB privilege required)");
        eprintln!("disposable_database={database}");
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect_with(options.database(&database))
            .await
            .expect("connect disposable database");
        if let Err(error) = migrator.run(&pool).await {
            pool.close().await;
            assert!(database.starts_with("opendeal_test_"));
            sqlx::query(&format!("DROP DATABASE {database} WITH (FORCE)"))
                .execute(&admin)
                .await
                .expect("clean up only this test's database after migration failure");
            admin.close().await;
            panic!("apply migrations to disposable database: {error}");
        }
        let mock = Arc::new(MockBitcoinRpc::new());
        let app = build_app(mock_state(pool.clone(), mock.clone()).await);
        Self {
            app,
            pool,
            admin,
            database,
            mock,
        }
    }
    async fn cleanup(self) {
        drop(self.app);
        self.pool.close().await;
        assert!(self.database.starts_with("opendeal_test_"));
        sqlx::query(&format!("DROP DATABASE {} WITH (FORCE)", self.database))
            .execute(&self.admin)
            .await
            .expect("remove only this test's newly created database");
        self.admin.close().await;
    }
}

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Value,
) -> (u16, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("Content-Type", "application/json");
    if let Some(token) = token {
        builder = builder.header("Authorization", format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(builder.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({"non_json":true}));
    (status, value)
}
async fn create_with_key(app: &Router, token: &str, key: &str, body: Value) -> (u16, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/deals")
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {token}"))
                .header("Idempotency-Key", key)
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}

async fn ok(app: &Router, method: &str, path: &str, token: &str, body: Value) -> Value {
    let (status, value) = request(app, method, path, Some(token), body).await;
    assert_eq!(status, 200, "{method} {path}: {value}");
    assert_eq!(value["success"], true);
    value["data"].clone()
}
async fn login(app: &Router, identity: &Identity) -> String {
    let (status, challenge) = request(
        app,
        "POST",
        "/auth/nostr/challenge",
        None,
        json!({"pubkey":identity.public}),
    )
    .await;
    assert_eq!(status, 200);
    let nonce = challenge["data"]["nonce"].as_str().unwrap();
    let event = nostr::event::EventBuilder::new(nostr::event::Kind::Custom(22242), nonce)
        .finalize(&identity.keys)
        .unwrap();
    let (status, response) = request(
        app,
        "POST",
        "/auth/nostr/login",
        None,
        json!({"event":event}),
    )
    .await;
    assert_eq!(status, 200);
    let replay = request(
        app,
        "POST",
        "/auth/nostr/login",
        None,
        json!({"event":event}),
    )
    .await;
    assert_eq!(replay.0, 401);
    response["data"]["token"].as_str().unwrap().to_owned()
}
fn local_destination(identity: &Identity) -> String {
    let public = bitcoin::CompressedPublicKey(PublicKey::from_secret_key(
        &Secp256k1::new(),
        &identity.secret,
    ));
    Address::p2wpkh(&public, Network::Regtest).to_string()
}
async fn approve_test_mediator(app: &Router, identity: &Identity) {
    let config = test_config();
    let keys = crate::auth::jwt::JwtKeys::new(&config.jwt_secret, config.access_token_ttl);
    let token = keys.issue(&identity.public).unwrap();
    let signature = opendeal_core::sign_bytes(
        &identity.secret,
        &crate::mediators::registration_bytes(&identity.public, "Test mediator"),
    );
    ok(
        app,
        "POST",
        "/mediators",
        &token,
        json!({"display_name":"Test mediator","signature":signature}),
    )
    .await;
    let admin = keys.issue(&config.admin_pubkeys[0]).unwrap();
    ok(
        app,
        "POST",
        &format!("/mediators/{}/status", identity.public),
        &admin,
        json!({"status":"approved"}),
    )
    .await;
}

async fn create(
    app: &Router,
    seller: &str,
    buyer: &Identity,
    mediator: &Identity,
    payout: &str,
    refund: &str,
) -> Value {
    approve_test_mediator(app, mediator).await;
    ok(app,"POST","/deals",seller,json!({"title":"Integration deal","description":"Disposable integration test","amount_sats":100000,"buyer_pubkey":buyer.public,"mediator_pubkey":mediator.public,"delivery_deadline":chrono::Utc::now()+chrono::Duration::days(1),"acceptance_window_hours":24,"seller_payout_address":payout,"buyer_refund_address":refund,"network":"regtest","settlement_model":"bitcoin_multisig_2of3"})).await
}
async fn sign_deal(
    app: &Router,
    id: &str,
    buyer: &Identity,
    seller: &Identity,
    bt: &str,
    st: &str,
) -> Agreement {
    let agreement: Agreement = serde_json::from_value(
        ok(
            app,
            "GET",
            &format!("/deals/{id}/agreement"),
            bt,
            json!(null),
        )
        .await,
    )
    .unwrap();
    assert_eq!(agreement.agreement_id().unwrap(), id);
    ok(
        app,
        "POST",
        &format!("/deals/{id}/sign"),
        st,
        seller.agreement_signature(&agreement),
    )
    .await;
    let agreed = ok(
        app,
        "POST",
        &format!("/deals/{id}/sign"),
        bt,
        buyer.agreement_signature(&agreement),
    )
    .await;
    assert_eq!(agreed["status"], "agreed");
    agreement
}
fn signer_update(base: &str, identity: &Identity) -> String {
    use bitcoin::hashes::Hash;
    use bitcoin::sighash::{EcdsaSighashType, SighashCache};
    let mut psbt = psbt_from_base64(base).unwrap();
    let input = &psbt.inputs[0];
    let hash = SighashCache::new(&psbt.unsigned_tx)
        .p2wsh_signature_hash(
            0,
            input.witness_script.as_ref().unwrap(),
            input.witness_utxo.as_ref().unwrap().value,
            EcdsaSighashType::All,
        )
        .unwrap();
    let secp = Secp256k1::new();
    let signature = secp.sign_ecdsa(
        &bitcoin::secp256k1::Message::from_digest(hash.to_byte_array()),
        &identity.secret,
    );
    psbt.inputs[0].partial_sigs.insert(
        bitcoin::PublicKey::new(PublicKey::from_secret_key(&secp, &identity.secret)),
        bitcoin::ecdsa::Signature {
            signature,
            sighash_type: EcdsaSighashType::All,
        },
    );
    psbt_to_base64(&psbt).unwrap()
}

#[tokio::test]
#[ignore = "requires OPENDEAL_TEST_ADMIN_URL; creates and removes its own disposable database"]
async fn database_http_workflow() {
    let fixture = Fixture::new().await;
    let app_owned = fixture.app.clone();
    let mock = fixture.mock.clone();
    let test_pool = fixture.pool.clone();
    let result = tokio::spawn(async move {
    let app = &app_owned;
    let seller = Identity::fresh();
    let buyer = Identity::fresh();
    let mediator = Identity::fresh();
    let outsider = Identity::fresh();
    let st = login(app, &seller).await;
    let bt = login(app, &buyer).await;
    let mt = login(app, &mediator).await;
    let ot = login(app, &outsider).await;
    let payout = local_destination(&seller);
    let refund = local_destination(&buyer);
    approve_test_mediator(app, &mediator).await;
    let body = json!({"title":"Idempotency test","amount_sats":100000,"buyer_pubkey":buyer.public,"mediator_pubkey":mediator.public,"delivery_deadline":chrono::Utc::now()+chrono::Duration::days(1),"acceptance_window_hours":24,"seller_payout_address":payout,"buyer_refund_address":refund});
    let first = create_with_key(app,&st,"create-once",body.clone()).await;
    let repeated = create_with_key(app,&st,"create-once",body.clone()).await;
    assert_eq!(first.0,200); assert_eq!(repeated.0,200); assert_eq!(first.1["data"]["id"],repeated.1["data"]["id"]);
    let mut changed=body.clone(); changed["title"]=json!("Changed title");
    assert_eq!(create_with_key(app,&st,"create-once",changed).await.0,409);
    let other_actor=create_with_key(app,&ot,"create-once",body.clone()).await;
    assert_eq!(other_actor.0,200);assert_ne!(first.1["data"]["id"],other_actor.1["data"]["id"]);
    for (field,value,status) in [
        ("network",json!("bitcoin"),400), ("amount_sats",json!(0),400),
        ("buyer_pubkey",json!("invalid"),400), ("mediator_pubkey",json!(buyer.public),400),
        ("seller_pubkey",json!(buyer.public),403), ("private_key",json!("forbidden-field"),422),
    ] {
        let mut invalid=body.clone(); invalid[field]=value;
        assert_eq!(request(app,"POST","/deals",Some(&st),invalid).await.0,status,"field {field}");
    }
    // Reproduce the old acceptance bug in disposable data: seller + mediator,
    // with the row labeled agreed. Funding must still require buyer consent.
    let legacy_id = first.1["data"]["id"].as_str().unwrap();
    let legacy_agreement: Agreement = serde_json::from_value(ok(app,"GET",&format!("/deals/{legacy_id}/agreement"),&st,json!(null)).await).unwrap();
    for identity in [&seller,&mediator] {
        let signature=identity.agreement_signature(&legacy_agreement)["signature"].clone();
        sqlx::query("INSERT INTO agreement_signatures (agreement_id,pubkey,signature_json) VALUES ($1,$2,$3)").bind(legacy_id).bind(&identity.public).bind(signature).execute(&test_pool).await.unwrap();
    }
    sqlx::query("UPDATE deals SET status='agreed' WHERE id=$1").bind(legacy_id).execute(&test_pool).await.unwrap();
    assert_eq!(request(app,"POST",&format!("/deals/{legacy_id}/funding/prepare"),Some(&st),json!({})).await.0,409);
    let deal = create(app, &st, &buyer, &mediator, &payout, &refund).await;
    let id = deal["id"].as_str().unwrap();
    let prefix = format!("/deals/{id}");
    for suffix in [
        "",
        "/agreement",
        "/funding",
        "/events",
        "/receipt",
        "/evidence",
        "/settlement",
    ] {
        assert_eq!(
            request(
                app,
                "GET",
                &format!("{prefix}{suffix}"),
                Some(&ot),
                json!(null)
            )
            .await
            .0,
            403
        );
    }
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{prefix}/transition"),
            Some(&bt),
            json!({"to":"funded"})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{prefix}/funding/prepare"),
            Some(&st),
            json!({})
        )
        .await
        .0,
        409
    );
    let agreement: Agreement = serde_json::from_value(
        ok(app, "GET", &format!("{prefix}/agreement"), &st, json!(null)).await,
    )
    .unwrap();
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{prefix}/sign"),
            Some(&mt),
            mediator.agreement_signature(&agreement)
        )
        .await
        .0,
        403
    );
    let mut invalid = buyer.agreement_signature(&agreement);
    invalid["signature"]["sig"] = json!("00".repeat(64));
    assert_eq!(
        request(app, "POST", &format!("{prefix}/sign"), Some(&bt), invalid)
            .await
            .0,
        400
    );
    sign_deal(app, id, &buyer, &seller, &bt, &st).await;
    let before = ok(app, "GET", &format!("{prefix}/events"), &st, json!(null)).await;
    ok(
        app,
        "POST",
        &format!("{prefix}/sign"),
        &bt,
        buyer.agreement_signature(&agreement),
    )
    .await;
    assert_eq!(
        ok(app, "GET", &format!("{prefix}/events"), &st, json!(null)).await,
        before
    );
    ok(
        app,
        "POST",
        &format!("{prefix}/funding/prepare"),
        &st,
        json!({}),
    )
    .await;
    let funding = ok(app, "GET", &format!("{prefix}/funding"), &st, json!(null)).await;
    let txid = "ab".repeat(32);
    let mut utxo = UtxoInfo {
        txid: txid.clone(),
        vout: 0,
        amount_sats: 99_999,
        confirmations: 1,
        script_pubkey_hex: funding["script_pubkey_hex"].as_str().unwrap().into(),
    };
    mock.insert_utxo(utxo.clone());
    assert_eq!(
        ok(
            app,
            "POST",
            &format!("{prefix}/funding/verify"),
            &bt,
            json!({})
        )
        .await["status"],
        "awaiting_payment"
    );
    utxo.amount_sats = 100_000;
    utxo.confirmations = 0;
    mock.insert_utxo(utxo.clone());
    assert_eq!(
        ok(
            app,
            "POST",
            &format!("{prefix}/funding/verify"),
            &bt,
            json!({})
        )
        .await["status"],
        "awaiting_payment"
    );
    utxo.confirmations = 1;
    mock.insert_utxo(utxo.clone());
    assert_eq!(
        ok(
            app,
            "POST",
            &format!("{prefix}/funding/verify"),
            &bt,
            json!({})
        )
        .await["status"],
        "funded"
    );
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{prefix}/transition"),
            Some(&bt),
            json!({"to":"shipped"})
        )
        .await
        .0,
        403
    );
    ok(
        app,
        "POST",
        &format!("{prefix}/transition"),
        &st,
        json!({"to":"shipped"}),
    )
    .await;
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{prefix}/transition"),
            Some(&st),
            json!({"to":"accepted"})
        )
        .await
        .0,
        403
    );
    let proposal = json!({"destination_address":payout,"fee_sats":1000,"purpose":"payout_seller"});
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{prefix}/settlement/propose"),
            Some(&st),
            proposal.clone()
        )
        .await
        .0,
        409
    );
    ok(
        app,
        "POST",
        &format!("{prefix}/transition"),
        &bt,
        json!({"to":"accepted"}),
    )
    .await;
    for bad in [
        json!({"destination_address":payout,"fee_sats":20000,"purpose":"payout_seller"}),
        json!({"destination_address":refund,"fee_sats":1000,"purpose":"payout_seller"}),
        json!({"destination_address":payout,"fee_sats":1000,"purpose":"unknown"}),
    ] {
        assert_eq!(
            request(
                app,
                "POST",
                &format!("{prefix}/settlement/propose"),
                Some(&bt),
                bad
            )
            .await
            .0,
            400
        );
    }
    let proposed = ok(
        app,
        "POST",
        &format!("{prefix}/settlement/propose"),
        &st,
        proposal,
    )
    .await;
    let base = proposed["current_psbt"].as_str().unwrap();
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{prefix}/settlement/finalize"),
            Some(&bt),
            json!({})
        )
        .await
        .0,
        400
    );
    let mut mutated = psbt_from_base64(base).unwrap();
    mutated.unsigned_tx.input[0].previous_output.vout = 1;
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{prefix}/settlement/sign"),
            Some(&bt),
            json!({"signed_psbt":psbt_to_base64(&mutated).unwrap()})
        )
        .await
        .0,
        400
    );
    let unrelated = signer_update(base, &outsider);
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{prefix}/settlement/sign"),
            Some(&bt),
            json!({"signed_psbt":unrelated})
        )
        .await
        .0,
        400
    );
    let mut corrupted = psbt_from_base64(&signer_update(base,&buyer)).unwrap();
    let key=bitcoin::PublicKey::new(PublicKey::from_secret_key(&Secp256k1::new(),&buyer.secret));
    corrupted.inputs[0].partial_sigs.get_mut(&key).unwrap().signature=Secp256k1::new().sign_ecdsa(&bitcoin::secp256k1::Message::from_digest([42;32]),&buyer.secret);
    assert_eq!(request(app,"POST",&format!("{prefix}/settlement/sign"),Some(&bt),json!({"signed_psbt":psbt_to_base64(&corrupted).unwrap()})).await.0,400);
    // Concurrent independent signatures must both survive row-lock serialization.
    let sign_path = format!("{prefix}/settlement/sign");
    let left = request(
        app,
        "POST",
        &sign_path,
        Some(&bt),
        json!({"signed_psbt":signer_update(base,&buyer)}),
    );
    let right = request(
        app,
        "POST",
        &sign_path,
        Some(&st),
        json!({"signed_psbt":signer_update(base,&seller)}),
    );
    let (left, right) = tokio::join!(left, right);
    assert_eq!(left.0, 200);
    assert_eq!(right.0, 200);
    assert_eq!(
        ok(
            app,
            "GET",
            &format!("{prefix}/settlement"),
            &st,
            json!(null)
        )
        .await["valid_signatures"],
        2
    );
    let result = ok(
        app,
        "POST",
        &format!("{prefix}/settlement/finalize"),
        &bt,
        json!({}),
    )
    .await;
    let settlement = result["settlement_txid"].as_str().unwrap();
    assert_eq!(result["status"], "accepted");
    assert_eq!(result["settlement_phase"], "broadcast");
    ok(
        app,
        "POST",
        &format!("{prefix}/settlement/finalize"),
        &st,
        json!({}),
    )
    .await;
    assert_eq!(mock.broadcast_count(), 1);
    assert_eq!(
        ok(
            app,
            "POST",
            &format!("{prefix}/settlement/confirm"),
            &bt,
            json!({})
        )
        .await["status"],
        "accepted"
    );
    mock.set_transaction_status(
        settlement,
        TransactionStatus {
            found: true,
            confirmations: 1,
            block_hash: Some("cd".repeat(32)),
        },
    );
    assert_eq!(
        ok(
            app,
            "POST",
            &format!("{prefix}/settlement/confirm"),
            &bt,
            json!({})
        )
        .await["status"],
        "settled"
    );
    let receipt: DealReceipt = serde_json::from_value(
        ok(app, "GET", &format!("{prefix}/receipt"), &st, json!(null)).await,
    )
    .unwrap();
    receipt.verify().unwrap();
    let mut tampered = receipt.clone();
    tampered.network = "bitcoin".into();
    assert!(tampered.verify().is_err());
    tampered = receipt.clone();
    tampered.settlement_txid = Some("ee".repeat(32));
    assert!(tampered.verify().is_err());
    tampered = receipt.clone();
    tampered.events[0].actor_pubkey = "00".repeat(32);
    assert!(tampered.verify().is_err());
    mock
        .set_transaction_status(settlement, TransactionStatus::default());
    assert_eq!(
        ok(
            app,
            "POST",
            &format!("{prefix}/settlement/confirm"),
            &bt,
            json!({})
        )
        .await["status"],
        "accepted"
    );
    let reorged: DealReceipt = serde_json::from_value(
        ok(app, "GET", &format!("{prefix}/receipt"), &bt, json!(null)).await,
    )
    .unwrap();
    reorged.verify().unwrap();

    // A fresh buyer identity gives the second agreement a unique escrow script.
    let buyer = Identity::fresh();
    let bt = login(app, &buyer).await;
    let refund = local_destination(&buyer);
    // A second deal exercises evidence authorization and mediator-assisted refund.
    let second = create(app, &st, &buyer, &mediator, &payout, &refund).await;
    let id2 = second["id"].as_str().unwrap();
    let p2 = format!("/deals/{id2}");
    sign_deal(app, id2, &buyer, &seller, &bt, &st).await;
    ok(
        app,
        "POST",
        &format!("{p2}/funding/prepare"),
        &st,
        json!({}),
    )
    .await;
    let funding2 = ok(app,"GET",&format!("{p2}/funding"),&bt,json!(null)).await;
    utxo.script_pubkey_hex = funding2["script_pubkey_hex"].as_str().unwrap().into();
    utxo.txid = "ef".repeat(32);
    mock.insert_utxo(utxo);
    ok(app, "POST", &format!("{p2}/funding/verify"), &bt, json!({})).await;
    let evidence = ok(
        app,
        "POST",
        &format!("{p2}/evidence"),
        &bt,
        json!({"kind":"text","content":"Item not delivered"}),
    )
    .await;
    assert_eq!(evidence["content_sha256"].as_str().unwrap().len(), 64);
    assert_eq!(
        request(
            app,
            "GET",
            &format!("{p2}/evidence"),
            Some(&ot),
            json!(null)
        )
        .await
        .0,
        403
    );
    let dispute = ok(
        app,
        "POST",
        &format!("{p2}/disputes"),
        &bt,
        json!({"reason":"Not delivered"}),
    )
    .await;
    let dispute_path = format!("/disputes/{}", dispute["id"].as_str().unwrap());
    assert_eq!(request(app,"POST",&format!("{dispute_path}/resolve"),Some(&ot),json!({"decision":"refund","rationale":"Unauthorized"})).await.0,403);
    assert_eq!(
        request(app, "GET", &dispute_path, Some(&ot), json!(null))
            .await
            .0,
        403
    );
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{dispute_path}/resolve"),
            Some(&st),
            json!({"decision":"refund","rationale":"Refund due"})
        )
        .await
        .0,
        403
    );
    ok(
        app,
        "POST",
        &format!("{dispute_path}/resolve"),
        &mt,
        json!({"decision":"refund","rationale":"Refund due"}),
    )
    .await;
    assert_eq!(
        ok(app, "GET", &p2, &bt, json!(null)).await["status"],
        "disputed"
    );
    assert_eq!(
        request(
            app,
            "POST",
            &format!("{p2}/settlement/propose"),
            Some(&st),
            json!({"destination_address":payout,"fee_sats":1000,"purpose":"payout_seller"})
        )
        .await
        .0,
        409
    );
    let refund_psbt = ok(
        app,
        "POST",
        &format!("{p2}/settlement/propose"),
        &bt,
        json!({"destination_address":refund,"fee_sats":1000,"purpose":"refund_buyer"}),
    )
    .await;
    let base = refund_psbt["current_psbt"].as_str().unwrap();
    for (who, token) in [(&buyer, &bt), (&mediator, &mt)] {
        ok(
            app,
            "POST",
            &format!("{p2}/settlement/sign"),
            token,
            json!({"signed_psbt":signer_update(base,who)}),
        )
        .await;
    }
    let refunded = ok(
        app,
        "POST",
        &format!("{p2}/settlement/finalize"),
        &bt,
        json!({}),
    )
    .await;
    mock.set_transaction_status(
        refunded["settlement_txid"].as_str().unwrap(),
        TransactionStatus {
            found: true,
            confirmations: 1,
            block_hash: Some("dc".repeat(32)),
        },
    );
    assert_eq!(
        ok(
            app,
            "POST",
            &format!("{p2}/settlement/confirm"),
            &bt,
            json!({})
        )
        .await["status"],
        "refunded"
    );
    let receipt: DealReceipt =
        serde_json::from_value(ok(app, "GET", &format!("{p2}/receipt"), &bt, json!(null)).await)
            .unwrap();
    receipt.verify().unwrap();
    eprintln!(
        "PASS database HTTP payout, refund, authorization, signatures, funding, concurrency, receipts and reorg checks"
    );
    }).await;
    fixture.cleanup().await;
    result.expect("database HTTP workflow assertions failed (disposable database cleaned up)");
}

#[tokio::test]
async fn dev_session_is_off_unless_explicitly_enabled() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/opendeal_test")
        .unwrap();
    let mut state = mock_state(pool, Arc::new(MockBitcoinRpc::new())).await;
    let mut config = (*state.config).clone();
    config.dev_session_enabled = false;
    state.config = Arc::new(config);
    let app = build_app(state);
    let identity = Identity::fresh();
    let (status, body) = request(
        &app,
        "POST",
        "/auth/dev/session",
        None,
        json!({"pubkey": identity.public}),
    )
    .await;
    assert_eq!(status, 403);
    assert!(body.to_string().contains("disabled"));
}

#[test]
fn dev_session_flag_is_refused_in_production() {
    let mut config = test_config();
    assert!(!config.dev_session_enabled, "off by default");
    config.app_env = AppEnv::Production;
    config.dev_session_enabled = true;
    let error = config.validate().unwrap_err().to_string();
    assert!(error.contains("OPENDEAL_DEV_SESSION_ENABLED"), "{}", error);
}

#[tokio::test]
async fn dev_session_rejects_client_role_claims() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/opendeal_test")
        .unwrap();
    let app = build_app(mock_state(pool, Arc::new(MockBitcoinRpc::new())).await);
    let identity = Identity::fresh();
    for field in ["role", "roleLabel", "private_key"] {
        let mut body = json!({"pubkey":identity.public});
        body[field] = json!("mediator");
        assert_eq!(
            request(&app, "POST", "/auth/dev/session", None, body)
                .await
                .0,
            422
        );
    }
}

#[tokio::test]
#[ignore = "requires OPENDEAL_TEST_ADMIN_URL; disposable database and mock Bitcoin only"]
async fn three_identity_roles_are_scoped_to_one_agreement() {
    let fixture = Fixture::new().await;
    let pool = fixture.pool.clone();
    let mock = fixture.mock.clone();
    let result = tokio::spawn(async move {
        let seller = Identity::fresh();
        let buyer = Identity::fresh();
        let mediator = Identity::fresh();
        let unrelated_mediator = Identity::fresh();
        let mut state = mock_state(pool, mock.clone()).await;
        state.mediator_pubkeys = Arc::new(std::collections::HashSet::from([
            mediator.public.clone(),
            unrelated_mediator.public.clone(),
        ]));
        let app = build_app(state);
        let mut tokens = Vec::new();
        for identity in [&seller, &buyer, &mediator, &unrelated_mediator] {
            let response = ok(
                &app,
                "POST",
                "/auth/dev/session",
                "",
                json!({"pubkey":identity.public}),
            )
            .await;
            assert_eq!(response["pubkey"], identity.public);
            let token = response["token"].as_str().unwrap().to_string();
            let payload = token.split('.').nth(1).unwrap();
            use base64::Engine;
            let claims: Value = serde_json::from_slice(
                &base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .decode(payload)
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(claims["sub"], identity.public);
            assert!(claims.get("role").is_none() && claims.get("roleLabel").is_none());
            tokens.push(token);
        }
        let (st, bt, mt, other) = (&tokens[0], &tokens[1], &tokens[2], &tokens[3]);
        let payout = local_destination(&seller);
        let refund = local_destination(&buyer);
        let deal = create(&app, st, &buyer, &mediator, &payout, &refund).await;
        let id = deal["id"].as_str().unwrap();
        let prefix = format!("/deals/{id}");
        assert_eq!(deal["seller_pubkey"], seller.public);
        assert_eq!(deal["buyer_pubkey"], buyer.public);
        assert_eq!(deal["mediator_pubkey"], mediator.public);
        let agreement: Agreement = serde_json::from_value(
            ok(&app, "GET", &format!("{prefix}/agreement"), bt, json!(null)).await,
        )
        .unwrap();
        assert_eq!(
            request(
                &app,
                "POST",
                &format!("{prefix}/sign"),
                Some(mt),
                mediator.agreement_signature(&agreement)
            )
            .await
            .0,
            403
        );
        assert_eq!(
            request(
                &app,
                "POST",
                &format!("{prefix}/sign"),
                Some(bt),
                seller.agreement_signature(&agreement)
            )
            .await
            .0,
            403
        );
        sign_deal(&app, id, &buyer, &seller, bt, st).await;
        ok(
            &app,
            "POST",
            &format!("{prefix}/funding/prepare"),
            bt,
            json!({}),
        )
        .await;
        let funding = ok(&app, "GET", &format!("{prefix}/funding"), bt, json!(null)).await;
        // Synthetic UTXO in an in-memory mock: no Bitcoin Core call or real payment.
        mock.insert_utxo(UtxoInfo {
            txid: "cd".repeat(32),
            vout: 0,
            amount_sats: 100_000,
            confirmations: 1,
            script_pubkey_hex: funding["script_pubkey_hex"].as_str().unwrap().into(),
        });
        assert_eq!(
            ok(
                &app,
                "POST",
                &format!("{prefix}/funding/verify"),
                bt,
                json!({})
            )
            .await["status"],
            "funded"
        );
        for token in [bt, mt] {
            assert_eq!(
                request(
                    &app,
                    "POST",
                    &format!("{prefix}/transition"),
                    Some(token),
                    json!({"to":"shipped"})
                )
                .await
                .0,
                403
            );
        }
        ok(
            &app,
            "POST",
            &format!("{prefix}/transition"),
            st,
            json!({"to":"shipped"}),
        )
        .await;
        for token in [st, mt] {
            assert_eq!(
                request(
                    &app,
                    "POST",
                    &format!("{prefix}/transition"),
                    Some(token),
                    json!({"to":"accepted"})
                )
                .await
                .0,
                403
            );
        }
        assert_eq!(
            ok(
                &app,
                "POST",
                &format!("{prefix}/transition"),
                bt,
                json!({"to":"accepted"})
            )
            .await["status"],
            "accepted"
        );
        let dispute = ok(
            &app,
            "POST",
            &format!("{prefix}/disputes"),
            bt,
            json!({"reason":"Mock-only role test"}),
        )
        .await;
        let dispute_id = dispute["id"].as_str().unwrap();
        for token in [st, bt] {
            assert_eq!(
                request(&app, "GET", "/disputes", Some(token), json!(null))
                    .await
                    .0,
                403
            );
        }
        let assigned = ok(&app, "GET", "/disputes", mt, json!(null)).await;
        assert_eq!(assigned.as_array().unwrap().len(), 1);
        assert_eq!(assigned[0]["agreement_id"], id);
        assert!(
            ok(&app, "GET", "/disputes", other, json!(null))
                .await
                .as_array()
                .unwrap()
                .is_empty()
        );
        let resolution = json!({"decision":"release","rationale":"Mock evidence reviewed"});
        for token in [st, bt, other] {
            assert_eq!(
                request(
                    &app,
                    "POST",
                    &format!("/disputes/{dispute_id}/resolve"),
                    Some(token),
                    resolution.clone()
                )
                .await
                .0,
                403
            );
        }
        ok(
            &app,
            "POST",
            &format!("/disputes/{dispute_id}/resolve"),
            mt,
            resolution,
        )
        .await;
        let proposed = ok(
            &app,
            "POST",
            &format!("{prefix}/settlement/propose"),
            bt,
            json!({"destination_address":payout,"fee_sats":1000,"purpose":"payout_seller"}),
        )
        .await;
        let base = proposed["current_psbt"].as_str().unwrap();
        for (identity, token) in [(&buyer, bt), (&mediator, mt)] {
            ok(
                &app,
                "POST",
                &format!("{prefix}/settlement/sign"),
                token,
                json!({"signed_psbt":signer_update(base, identity)}),
            )
            .await;
        }
        let progress = ok(
            &app,
            "GET",
            &format!("{prefix}/settlement"),
            bt,
            json!(null),
        )
        .await;
        assert_eq!(progress["valid_signatures"], 2);
        assert!(progress["txid"].is_null()); // Stop before finalize/broadcast.
    })
    .await;
    fixture.cleanup().await;
    result.expect("three-identity role assertions failed (disposable database cleaned up)");
}

mod live_api;

mod mediator_registry;

mod migration_replay;
