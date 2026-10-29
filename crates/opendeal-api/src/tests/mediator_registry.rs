use super::*;
use axum::extract::ConnectInfo;
use axum::http::HeaderMap;
use std::net::SocketAddr;

async fn demo_request(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    body: Value,
) -> (u16, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(format!("/api/v1{path}"))
                .header("host", "localhost:8080")
                .header("origin", "http://localhost:3000")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .extension(ConnectInfo("127.0.0.1:4567".parse::<SocketAddr>().unwrap()))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
fn registration(identity: &Identity, name: &str) -> Value {
    json!({"display_name":name,"signature":opendeal_core::sign_bytes(&identity.secret,&crate::mediators::registration_bytes(&identity.public,name))})
}

#[tokio::test]
async fn demo_controls_require_loopback_regtest_and_explicit_configuration() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/opendeal_test")
        .unwrap();
    let mut state = mock_state(pool, Arc::new(MockBitcoinRpc::new())).await;
    let peer = "127.0.0.1:1234".parse().unwrap();
    let mut headers = HeaderMap::new();
    headers.insert("host", "localhost:8080".parse().unwrap());
    headers.insert("origin", "http://localhost:3000".parse().unwrap());
    assert!(crate::mediators::demo_gate(&state, peer, &headers).is_err());
    let mut config = test_config();
    config.demo_enabled = true;
    assert!(config.validate().is_ok());
    state.config = Arc::new(config.clone());
    assert!(crate::mediators::demo_gate(&state, peer, &headers).is_ok());
    assert!(
        crate::mediators::demo_gate(&state, "192.0.2.1:1234".parse().unwrap(), &headers).is_err()
    );
    headers.insert("origin", "https://example.com".parse().unwrap());
    assert!(crate::mediators::demo_gate(&state, peer, &headers).is_err());
    headers.insert("origin", "http://localhost:3000".parse().unwrap());
    headers.insert("x-forwarded-for", "127.0.0.1".parse().unwrap());
    assert!(crate::mediators::demo_gate(&state, peer, &headers).is_err());
    headers.remove("x-forwarded-for");
    headers.insert("host", "public.example".parse().unwrap());
    assert!(crate::mediators::demo_gate(&state, peer, &headers).is_err());
    config.bitcoin_network = "mainnet".into();
    assert!(config.validate().is_err());
    state.config = Arc::new(config.clone());
    assert!(crate::mediators::demo_gate(&state, peer, &headers).is_err());
    config.bitcoin_network = "regtest".into();
    config.app_env = AppEnv::Production;
    assert!(config.validate().is_err());
    config.app_env = AppEnv::Test;
    config.cors_allowed_origins.clear();
    assert!(config.validate().is_err());
    config.cors_allowed_origins = vec!["https://public.example".into()];
    assert!(config.validate().is_err());
    assert!(!crate::mediators::loopback_url(
        "http://localhost.evil.example"
    ));
    assert!(!crate::mediators::loopback_url(
        "http://127.0.0.1@evil.example"
    ));
    assert!(!crate::mediators::loopback_url("http://example.com"));
}

#[tokio::test]
async fn registry_proof_admin_and_disabled_demo_fail_before_database_access() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://localhost/opendeal_test")
        .unwrap();
    let state = mock_state(pool, Arc::new(MockBitcoinRpc::new())).await;
    let mediator = Identity::fresh();
    let other = Identity::fresh();
    let token = state.jwt.issue(&mediator.public).unwrap();
    let app = build_app(state);
    assert_eq!(
        request(&app, "GET", "/mediators/review", Some(&token), json!(null))
            .await
            .0,
        403
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &format!("/mediators/{}/status", mediator.public),
            Some(&token),
            json!({"status":"approved"})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/mediators",
            Some(&token),
            registration(&other, "Other")
        )
        .await
        .0,
        403
    );
    let wrong_kind = nostr::event::EventBuilder::new(
        nostr::event::Kind::Custom(1),
        String::from_utf8(crate::mediators::registration_bytes(
            &mediator.public,
            "Nostr mediator",
        ))
        .unwrap(),
    )
    .finalize(&mediator.keys)
    .unwrap();
    assert_eq!(
        request(
            &app,
            "POST",
            "/mediators",
            Some(&token),
            json!({"display_name":"Nostr mediator","event":wrong_kind})
        )
        .await
        .0,
        400
    );
    let correct = nostr::event::EventBuilder::new(
        nostr::event::Kind::Custom(22242),
        String::from_utf8(crate::mediators::registration_bytes(
            &mediator.public,
            "Nostr mediator",
        ))
        .unwrap(),
    )
    .finalize(&mediator.keys)
    .unwrap();
    let mut invalid_event = serde_json::to_value(correct).unwrap();
    invalid_event["content"] = json!("tampered application");
    assert_eq!(
        request(
            &app,
            "POST",
            "/mediators",
            Some(&token),
            json!({"display_name":"Nostr mediator","event":invalid_event})
        )
        .await
        .0,
        401
    );
    let mut tampered = registration(&mediator, "Real name");
    tampered["display_name"] = json!("Changed name");
    assert_eq!(
        request(&app, "POST", "/mediators", Some(&token), tampered)
            .await
            .0,
        400
    );
    assert_eq!(
        demo_request(
            &app,
            "POST",
            &format!("/demo/mediators/{}/approve", mediator.public),
            &token,
            json!({"confirmation":"APPROVE LOCAL REGTEST MEDIATOR"})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        demo_request(
            &app,
            "POST",
            "/demo/addresses",
            &token,
            json!({"confirmation":"GENERATE REGTEST ADDRESS"})
        )
        .await
        .0,
        403
    );
    assert_eq!(
        demo_request(&app, "GET", "/demo/wallet", &token, json!(null))
            .await
            .0,
        403
    );
}

#[tokio::test]
#[ignore = "requires OPENDEAL_TEST_ADMIN_URL; disposable registry database and mock Bitcoin only"]
async fn registry_approval_suspension_and_assignment() {
    let fixture = Fixture::new().await;
    let pool = fixture.pool.clone();
    let mock = fixture.mock.clone();
    let result=tokio::spawn(async move {
        let state=mock_state(pool,mock.clone()).await;let seller=Identity::fresh();let buyer=Identity::fresh();let mediator=Identity::fresh();
        let st=state.jwt.issue(&seller.public).unwrap();let bt=state.jwt.issue(&buyer.public).unwrap();let mt=state.jwt.issue(&mediator.public).unwrap();let admin=state.jwt.issue(&state.config.admin_pubkeys[0]).unwrap();
        let mut legacy=state.clone();legacy.mediator_pubkeys=Arc::new(std::collections::HashSet::from([mediator.public.clone()]));
        assert!(crate::mediators::approved(&legacy,&mediator.public).await.unwrap());
        let app=build_app(state.clone());
        let event=nostr::event::EventBuilder::new(nostr::event::Kind::Custom(22242),String::from_utf8(crate::mediators::registration_bytes(&mediator.public,"Registry mediator")).unwrap()).finalize(&mediator.keys).unwrap();
        let pending=ok(&app,"POST","/mediators",&mt,json!({"display_name":"Registry mediator","event":event})).await;assert_eq!(pending["status"],"pending");
        assert!(!crate::mediators::approved(&state,&mediator.public).await.unwrap());
        let body=json!({"title":"Registry selection","amount_sats":100000,"buyer_pubkey":buyer.public,"mediator_pubkey":mediator.public,"delivery_deadline":chrono::Utc::now()+chrono::Duration::days(1),"acceptance_window_hours":24,"seller_payout_address":local_destination(&seller),"buyer_refund_address":local_destination(&buyer)});
        assert_eq!(request(&app,"POST","/deals",Some(&st),body.clone()).await.0,400);
        assert_eq!(request(&app,"POST",&format!("/mediators/{}/status",mediator.public),Some(&mt),json!({"status":"approved"})).await.0,403);
        ok(&app,"POST",&format!("/mediators/{}/status",mediator.public),&admin,json!({"status":"approved"})).await;
        let directory=ok(&app,"GET","/mediators",&st,json!(null)).await;assert_eq!(directory.as_array().unwrap().len(),1);assert_eq!(directory[0]["pubkey"],mediator.public);
        let deal=ok(&app,"POST","/deals",&st,body.clone()).await;let id=deal["id"].as_str().unwrap();let prefix=format!("/deals/{id}");
        sign_deal(&app,id,&buyer,&seller,&bt,&st).await;
        ok(&app,"POST",&format!("{prefix}/funding/prepare"),&bt,json!({})).await;
        let funding=ok(&app,"GET",&format!("{prefix}/funding"),&bt,json!(null)).await;
        mock.insert_utxo(UtxoInfo{txid:"ef".repeat(32),vout:0,amount_sats:100000,confirmations:1,script_pubkey_hex:funding["script_pubkey_hex"].as_str().unwrap().into()});
        ok(&app,"POST",&format!("{prefix}/funding/verify"),&bt,json!({})).await;
        let dispute=ok(&app,"POST",&format!("{prefix}/disputes"),&bt,json!({"reason":"Registry suspension fixture"})).await;
        assert_eq!(ok(&app,"GET","/disputes",&mt,json!(null)).await.as_array().unwrap().len(),1);
        let suspended=ok(&app,"POST",&format!("/mediators/{}/status",mediator.public),&admin,json!({"status":"suspended"})).await;assert_eq!(suspended["reviewed_by"],state.config.admin_pubkeys[0]);
        assert!(!crate::mediators::approved(&legacy,&mediator.public).await.unwrap()); // static keys cannot override suspension
        assert_eq!(request(&app,"GET","/disputes",Some(&mt),json!(null)).await.0,403);
        let resolution=format!("/disputes/{}/resolve",dispute["id"].as_str().unwrap());
        assert_eq!(request(&app,"POST",&resolution,Some(&mt),json!({"decision":"refund","rationale":"not authorized"})).await.0,403);
        ok(&app,"GET",&format!("{prefix}/events"),&mt,json!(null)).await; // assigned history remains readable
        assert_eq!(ok(&app,"POST","/mediators",&mt,registration(&mediator,"Registry mediator")).await["status"],"suspended"); // replay cannot reapprove
        assert!(ok(&app,"GET","/mediators",&bt,json!(null)).await.as_array().unwrap().is_empty());
        assert_eq!(request(&app,"POST","/deals",Some(&st),body).await.0,400);
        ok(&app,"POST",&format!("/mediators/{}/status",mediator.public),&admin,json!({"status":"approved"})).await;
        ok(&app,"POST",&resolution,&mt,json!({"decision":"refund","rationale":"reapproved and reviewed"})).await;
        let proposal=ok(&app,"POST",&format!("{prefix}/settlement/propose"),&bt,json!({"destination_address":local_destination(&buyer),"fee_sats":1000,"purpose":"refund_buyer"})).await;
        let base=proposal["current_psbt"].as_str().unwrap();
        let mediator_update=signer_update(base,&mediator);
        ok(&app,"POST",&format!("/mediators/{}/status",mediator.public),&admin,json!({"status":"suspended"})).await;
        assert_eq!(request(&app,"POST",&format!("{prefix}/settlement/sign"),Some(&bt),json!({"signed_psbt":mediator_update})).await.0,403);
        ok(&app,"POST",&format!("{prefix}/settlement/sign"),&bt,json!({"signed_psbt":signer_update(base,&buyer)})).await;
        ok(&app,"POST",&format!("/mediators/{}/status",mediator.public),&admin,json!({"status":"approved"})).await;
        ok(&app,"POST",&format!("{prefix}/settlement/sign"),&bt,json!({"signed_psbt":mediator_update})).await;

    }).await;
    fixture.cleanup().await;
    result.expect("registry assertions failed (fixture removed)");
}

#[tokio::test]
#[ignore = "requires OPENDEAL_TEST_ADMIN_URL; disposable registry database, no Bitcoin RPC"]
async fn local_demo_approval_requires_confirmation_and_matching_registered_identity() {
    let fixture = Fixture::new().await;
    let pool = fixture.pool.clone();
    let mock = fixture.mock.clone();
    let result = tokio::spawn(async move {
        let mut state = mock_state(pool, mock).await;
        let mut config = (*state.config).clone();
        config.demo_enabled = true;
        state.config = Arc::new(config);
        let mediator = Identity::fresh();
        let other = Identity::fresh();
        let token = state.jwt.issue(&mediator.public).unwrap();
        let other_token = state.jwt.issue(&other.public).unwrap();
        let app = build_app(state);
        ok(
            &app,
            "POST",
            "/mediators",
            &token,
            registration(&mediator, "Local test mediator"),
        )
        .await;
        let path = format!("/demo/mediators/{}/approve", mediator.public);
        assert_eq!(
            demo_request(&app, "POST", &path, &token, json!({"confirmation":""}))
                .await
                .0,
            403
        );
        assert_eq!(
            demo_request(
                &app,
                "POST",
                &path,
                &other_token,
                json!({"confirmation":"APPROVE LOCAL REGTEST MEDIATOR"})
            )
            .await
            .0,
            403
        );
        assert_eq!(
            demo_request(
                &app,
                "POST",
                &path,
                &token,
                json!({"confirmation":"APPROVE LOCAL REGTEST MEDIATOR"})
            )
            .await
            .1["data"]["status"],
            "approved"
        );
        assert_eq!(
            demo_request(
                &app,
                "POST",
                "/demo/addresses",
                &token,
                json!({"confirmation":""})
            )
            .await
            .0,
            400
        );
    })
    .await;
    fixture.cleanup().await;
    result.expect("local approval assertions failed (fixture removed)");
}
