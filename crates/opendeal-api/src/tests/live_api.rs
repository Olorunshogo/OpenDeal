//! Real HTTP + disposable PostgreSQL + opt-in Polar regtest. Never auto-retry funding.
use super::*;
use opendeal_bitcoin::rpc::BitcoinChain;
use opendeal_bitcoin::{BitcoinRpc, HttpBitcoinRpc};
use std::str::FromStr;

fn required(name: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| panic!("export {name}"))
}
struct Core {
    url: reqwest::Url,
    user: String,
    password: String,
    client: reqwest::Client,
}
impl Core {
    async fn call(&self, method: &str, params: Value) -> Value {
        let response = self
            .client
            .post(self.url.clone())
            .basic_auth(&self.user, Some(&self.password))
            .json(
                &json!({"jsonrpc":"1.0","id":"opendeal-api-test","method":method,"params":params}),
            )
            .send()
            .await
            .unwrap_or_else(|_| panic!("{method}: transport failed"));
        let status = response.status();
        assert!(
            status.as_u16() != 401 && status.as_u16() != 403,
            "{method}: authentication failed"
        );
        let value: Value = response.json().await.expect("Core JSON response");
        assert!(
            value["error"].is_null(),
            "{method}: Core RPC error code {}",
            value["error"]["code"].as_i64().unwrap_or(0)
        );
        assert!(status.is_success(), "{method}: HTTP {}", status.as_u16());
        value["result"].clone()
    }
}
struct Http {
    base: String,
    client: reqwest::Client,
}
impl Http {
    async fn call(&self, method: &str, path: &str, token: Option<&str>, body: Value) -> Value {
        let method = reqwest::Method::from_bytes(method.as_bytes()).unwrap();
        let mut request = self
            .client
            .request(method, format!("{}/api/v1{path}", self.base))
            .json(&body);
        if let Some(token) = token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.expect("API HTTP transport");
        let status = response.status();
        let value: Value = response.json().await.expect("API JSON response");
        assert_eq!(
            status.as_u16(),
            200,
            "API {path} returned {}",
            status.as_u16()
        );
        assert_eq!(value["success"], true);
        value["data"].clone()
    }
    async fn login(&self, identity: &Identity) -> String {
        let challenge = self
            .call(
                "POST",
                "/auth/nostr/challenge",
                None,
                json!({"pubkey":identity.public}),
            )
            .await;
        let event = nostr::event::EventBuilder::new(
            nostr::event::Kind::Custom(22242),
            challenge["nonce"].as_str().unwrap(),
        )
        .finalize(&identity.keys)
        .unwrap();
        self.call("POST", "/auth/nostr/login", None, json!({"event":event}))
            .await["token"]
            .as_str()
            .unwrap()
            .to_owned()
    }
}
struct FundingNotice {
    txid: String,
    vout: Option<u32>,
    completed: bool,
}
impl Drop for FundingNotice {
    fn drop(&mut self) {
        if !self.completed {
            eprintln!(
                "LIVE API TEST STOPPED AFTER FUNDING: txid={} vout={:?}. Inspect this outpoint and any stored settlement txid before recovery. Test keys are ephemeral and not persisted; an unspent escrow may be unrecoverable after process exit. Do not automatically rerun or fund another escrow.",
                self.txid, self.vout
            );
        }
    }
}

#[tokio::test]
#[ignore = "requires OPENDEAL_LIVE_API_REGTEST=1, OPENDEAL_TEST_ADMIN_URL, RPC credentials and wallet; funds and mines on regtest"]
async fn live_api_regtest() {
    assert_eq!(
        required("OPENDEAL_LIVE_API_REGTEST"),
        "1",
        "explicit API test opt-in required"
    );
    assert_eq!(required("BITCOIN_NETWORK"), "regtest");
    let raw_url = required("BITCOIN_RPC_URL");
    let user = required("BITCOIN_RPC_USER");
    let password = required("BITCOIN_RPC_PASSWORD");
    let wallet = required("BITCOIN_RPC_WALLET");
    let mut url = reqwest::Url::parse(&raw_url).expect("valid RPC URL");
    assert!(
        matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none(),
        "use a root HTTP(S) node URL without credentials"
    );
    let mut core = Core {
        url: url.clone(),
        user: user.clone(),
        password: password.clone(),
        client: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap(),
    };
    assert_eq!(
        core.call("getblockchaininfo", json!([])).await["chain"],
        "regtest",
        "refuse non-regtest before any mutations"
    );
    url.path_segments_mut()
        .unwrap()
        .pop_if_empty()
        .push("wallet")
        .push(&wallet);
    core.url = url;
    assert_eq!(
        core.call("getwalletinfo", json!([])).await["private_keys_enabled"],
        true,
        "wallet must be spend-capable and unlocked"
    );
    let fixture = Fixture::new().await;
    let mut config = test_config();
    config.bitcoin_rpc_url = Some(raw_url.clone());
    config.bitcoin_rpc_user = Some(user.clone());
    config.bitcoin_rpc_password = Some(password.clone());
    let rpc = Arc::new(HttpBitcoinRpc::new(raw_url, user, password));
    rpc.check_network("regtest").await.unwrap();
    let adapter = MultisigSettlementAdapter::new(BitcoinMultisigAdapter::new(rpc.clone(), 1));
    let storage = crate::storage::ObjectStorage::from_config(&config)
        .await
        .unwrap();
    let mut state = AppState::new(fixture.pool.clone(), config, Arc::new(adapter), storage);
    state.rpc = rpc.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, build_app(state)).await.unwrap();
    });
    let http = Http {
        base,
        client: reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap(),
    };
    // Keep cleanup outside the task so assertion failures do not strand test databases.
    let outcome=tokio::spawn(async move {
        let buyer=Identity::fresh();let seller=Identity::fresh();let mediator=Identity::fresh();
        let bt=http.login(&buyer).await;let st=http.login(&seller).await;
        let mining=core.call("getnewaddress",json!(["opendeal-api-mining","bech32"])).await;
        let payout=core.call("getnewaddress",json!(["opendeal-api-seller","bech32"])).await;
        let refund=core.call("getnewaddress",json!(["opendeal-api-buyer","bech32"])).await;
        for address in [&mining,&payout,&refund] {
            address.as_str().unwrap().parse::<Address<bitcoin::address::NetworkUnchecked>>().unwrap().require_network(Network::Regtest).unwrap();
        }
        let balance=bitcoin::Amount::from_str_in(&core.call("getbalance",json!([])).await.to_string(),bitcoin::Denomination::Bitcoin).unwrap().to_sat();
        if balance<120_000 { core.call("generatetoaddress",json!([101,mining])).await; }
        let deal=http.call("POST","/deals",Some(&st),json!({"title":"HTTP regtest test","description":"Disposable API escrow lifecycle","amount_sats":100000,"buyer_pubkey":buyer.public,"mediator_pubkey":mediator.public,"delivery_deadline":chrono::Utc::now()+chrono::Duration::days(1),"acceptance_window_hours":24,"seller_payout_address":payout,"buyer_refund_address":refund})).await;
        let id=deal["id"].as_str().unwrap();let prefix=format!("/deals/{id}");eprintln!("live_api_agreement_id={id}");
        let agreement:Agreement=serde_json::from_value(http.call("GET",&format!("{prefix}/agreement"),Some(&bt),json!(null)).await).unwrap();assert_eq!(agreement.agreement_id().unwrap(),id);
        for (identity,token) in [(&seller,&st),(&buyer,&bt)] {
            http.call("POST",&format!("{prefix}/sign"),Some(token),identity.agreement_signature(&agreement)).await;
        }
        http.call("POST",&format!("{prefix}/funding/prepare"),Some(&bt),json!({})).await;
        let funding=http.call("GET",&format!("{prefix}/funding"),Some(&bt),json!(null)).await;
        let address=funding["address"].as_str().unwrap();
        address.parse::<Address<bitcoin::address::NetworkUnchecked>>().unwrap().require_network(Network::Regtest).unwrap();
        let funded=core.call("sendtoaddress",json!({"address":address,"amount":serde_json::Number::from_str("0.00100000").unwrap(),"fee_rate":2,"subtractfeefromamount":false})).await;
        let funding_txid=funded.as_str().expect("funding txid");
        let mut notice=FundingNotice{txid:funding_txid.into(),vout:None,completed:false};
        eprintln!("live_api_funding_txid={funding_txid}");
        let details=core.call("gettransaction",json!([funding_txid])).await;
        let funding_tx:bitcoin::Transaction=bitcoin::consensus::encode::deserialize_hex(details["hex"].as_str().unwrap()).unwrap();
        let script=bitcoin::ScriptBuf::from_hex(funding["script_pubkey_hex"].as_str().unwrap()).unwrap();
        let matches:Vec<_>=funding_tx.output.iter().enumerate().filter(|(_,out)|out.script_pubkey==script).collect();assert_eq!(matches.len(),1);
        let(vout,output)=matches[0];assert_eq!(output.value.to_sat(),100_000);let vout=u32::try_from(vout).unwrap();notice.vout=Some(vout);
        eprintln!("live_api_funding_outpoint={funding_txid}:{vout}");
        core.call("generatetoaddress",json!([1,mining])).await;
        let funding_confirmations=rpc.get_tx_out(funding_txid,vout).await.unwrap().unwrap().confirmations;
        let funded=http.call("POST",&format!("{prefix}/funding/verify"),Some(&bt),json!({})).await;assert_eq!(funded["status"],"funded");
        assert_eq!(funded["funding_txid"],funding_txid);assert_eq!(funded["funding_vout"],vout);
        http.call("POST",&format!("{prefix}/transition"),Some(&st),json!({"to":"shipped"})).await;
        http.call("POST",&format!("{prefix}/transition"),Some(&bt),json!({"to":"accepted"})).await;
        let proposed=http.call("POST",&format!("{prefix}/settlement/propose"),Some(&st),json!({"destination_address":payout,"fee_sats":1000,"purpose":"payout_seller"})).await;
        let base=proposed["current_psbt"].as_str().unwrap();
        for(identity,token) in [(&buyer,&bt),(&seller,&st)] {
            http.call("POST",&format!("{prefix}/settlement/sign"),Some(token),json!({"signed_psbt":signer_update(base,identity)})).await;
        }
        let broadcast=http.call("POST",&format!("{prefix}/settlement/finalize"),Some(&bt),json!({})).await;
        assert_eq!(broadcast["status"],"accepted");let settlement=broadcast["settlement_txid"].as_str().unwrap();eprintln!("live_api_settlement_txid={settlement}");
        let blocks=core.call("generatetoaddress",json!([1,mining])).await;let block=blocks[0].as_str().unwrap();
        let confirmed=http.call("POST",&format!("{prefix}/settlement/confirm"),Some(&bt),json!({"block_hash":block})).await;
        assert_eq!(confirmed["status"],"settled");assert_eq!(confirmed["settlement_phase"],"confirmed");
        let raw=core.call("getrawtransaction",json!([settlement,true,block])).await;assert_eq!(raw["in_active_chain"],true);
        let tx:bitcoin::Transaction=bitcoin::consensus::encode::deserialize_hex(raw["hex"].as_str().unwrap()).unwrap();
        assert_eq!(tx.compute_txid().to_string(),settlement);assert_eq!(tx.input.len(),1);assert_eq!(tx.input[0].previous_output.txid.to_string(),funding_txid);assert_eq!(tx.input[0].previous_output.vout,vout);
        assert_eq!(tx.output.len(),1);assert_eq!(tx.output[0].value.to_sat(),99_000);
        let destination=payout.as_str().unwrap().parse::<Address<bitcoin::address::NetworkUnchecked>>().unwrap().require_network(Network::Regtest).unwrap();assert_eq!(tx.output[0].script_pubkey,destination.script_pubkey());
        assert!(rpc.get_tx_out(funding_txid,vout).await.unwrap().is_none());
        let receipt:DealReceipt=serde_json::from_value(http.call("GET",&format!("{prefix}/receipt"),Some(&bt),json!(null)).await).unwrap();receipt.verify().unwrap();
        assert_eq!(receipt.funding_txid.as_deref(),Some(funding_txid));assert_eq!(receipt.settlement_txid.as_deref(),Some(settlement));
        let fee=bitcoin::SignedAmount::from_str_in(&details["fee"].to_string(),bitcoin::Denomination::Bitcoin).unwrap().to_sat().checked_neg().unwrap();
        eprintln!("PASS LIVE HTTP API agreement={id} funding={funding_txid}:{vout} funding_sats=100000 funding_fee_sats={fee} funding_confirmations={funding_confirmations} settlement={settlement} settlement_fee_sats=1000 output_sats=99000 settlement_confirmations={} receipt_verified=true",confirmed["settlement_confirmations"]);
        notice.completed=true;
    }).await;
    server.abort();
    let _ = server.await;
    fixture.cleanup().await;
    outcome.expect("live HTTP API lifecycle failed; never automatically rerun after funding");
}
