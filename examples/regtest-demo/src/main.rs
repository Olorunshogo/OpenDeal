#![allow(clippy::needless_return, clippy::uninlined_format_args)]

use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use chrono::{Duration as ChronoDuration, Utc};
use clap::{Parser, Subcommand};
use opendeal_bitcoin::escrow::parse_network;
use opendeal_bitcoin::{EscrowKeys, sign_psbt_with_secret};
use opendeal_core::{
    Agreement, DealEvent, DealReceipt, DealStatus, EventKind, EventPayload, SettlementModel,
    sign_bytes, verify_agreement_signature, verify_event_chain,
};
use secp256k1::{Secp256k1, SecretKey};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Parser)]
#[command(name = "regtest-demo", about = "OpenDeal protocol demo helpers")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    LaptopSale,
    VerifyReceipt { path: String },
    LiveE2e {
        #[arg(long, default_value = "http://127.0.0.1:8080")]
        api_url: String,
        #[arg(long, default_value = "http://opendeal:opendeal@127.0.0.1:18443")]
        bitcoin_rpc_url: String,
        #[arg(long, default_value_t = 50_000)]
        amount_sats: u64,
        #[arg(long, default_value_t = 500)]
        fee_sats: u64,
        #[arg(long)]
        receipt_out: Option<PathBuf>,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::LaptopSale => run_laptop_sale(),
        Commands::VerifyReceipt { path } => {
            if let Err(err) = verify_receipt_file(&path) {
                eprintln!("verify failed: {err:#}");
                std::process::exit(1);
            }
        }
        Commands::LiveE2e {
            api_url,
            bitcoin_rpc_url,
            amount_sats,
            fee_sats,
            receipt_out,
        } => {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("runtime");
            if let Err(err) = rt.block_on(run_live_e2e(
                &api_url,
                &bitcoin_rpc_url,
                amount_sats,
                fee_sats,
                receipt_out.unwrap_or_else(|| PathBuf::from("/tmp/opendeal-live-receipt.json")),
            )) {
                eprintln!("live-e2e failed: {err:#}");
                std::process::exit(1);
            }
        }
    }
}

fn verify_receipt_file(path: &str) -> Result<()> {
    let raw = std::fs::read_to_string(path).context("read receipt")?;
    let receipt: DealReceipt = serde_json::from_str(&raw).context("parse receipt")?;
    receipt.verify().context("receipt invalid")?;
    println!("receipt ok: {}", receipt.agreement_id);
    return Ok(());
}

fn run_laptop_sale() {
    let secp = Secp256k1::new();
    let sk_seller = SecretKey::from_slice(&[11u8; 32]).unwrap();
    let sk_buyer = SecretKey::from_slice(&[22u8; 32]).unwrap();
    let sk_mediator = SecretKey::from_slice(&[33u8; 32]).unwrap();

    let seller = hex::encode(secp256k1::PublicKey::from_secret_key(&secp, &sk_seller).serialize());
    let buyer = hex::encode(secp256k1::PublicKey::from_secret_key(&secp, &sk_buyer).serialize());
    let mediator =
        hex::encode(secp256k1::PublicKey::from_secret_key(&secp, &sk_mediator).serialize());

    let agreement = Agreement {
        version: 1,
        description: None,
        seller_payout_address: None,
        buyer_refund_address: None,
        title: "Used laptop".into(),
        amount_sats: 50_000,
        currency: "BTC".into(),
        seller_pubkey: seller.clone(),
        buyer_pubkey: buyer.clone(),
        mediator_pubkey: mediator.clone(),
        delivery_deadline: Utc::now() + ChronoDuration::days(3),
        acceptance_window_hours: 48,
        settlement_model: SettlementModel::BitcoinMultisig2of3,
        network: "regtest".into(),
        created_at: Utc::now(),
    };
    let agreement_id = agreement.agreement_id().expect("id");
    let bytes = agreement.canonical_bytes().expect("canonical");
    let sig_seller = sign_bytes(&sk_seller, &bytes);
    let sig_buyer = sign_bytes(&sk_buyer, &bytes);
    verify_agreement_signature(&agreement, &sig_seller).expect("seller sig");
    verify_agreement_signature(&agreement, &sig_buyer).expect("buyer sig");

    let keys = EscrowKeys {
        buyer_pubkey: buyer,
        seller_pubkey: seller,
        mediator_pubkey: mediator,
    };
    let network = parse_network("regtest").unwrap();
    let escrow = keys.build_escrow(network).expect("escrow");

    let mut events = Vec::new();
    let e0 = DealEvent::unsigned(
        agreement_id.clone(),
        0,
        EventKind::DealCreated,
        EventPayload::DealCreated {
            agreement_id: agreement_id.clone(),
        },
        agreement.seller_pubkey.clone(),
        String::new(),
        Utc::now(),
    );
    let h0 = e0.event_hash().unwrap();
    events.push(e0);
    events.push(DealEvent::unsigned(
        agreement_id.clone(),
        1,
        EventKind::AgreementSigned,
        EventPayload::AgreementSigned {
            role: "seller".into(),
            pubkey: agreement.seller_pubkey.clone(),
        },
        agreement.seller_pubkey.clone(),
        h0,
        Utc::now(),
    ));
    verify_event_chain(&events).expect("chain");

    let receipt = DealReceipt {
        agreement: agreement.clone(),
        agreement_id: agreement_id.clone(),
        status: DealStatus::Draft,
        settlement_model: SettlementModel::BitcoinMultisig2of3,
        network: "regtest".into(),
        agreement_signatures: vec![sig_seller, sig_buyer],
        events,
        funding_txid: None,
        settlement_txid: None,
    };

    println!("agreement_id={}", agreement_id);
    println!("escrow_address={}", escrow.address);
    println!("{}", serde_json::to_string_pretty(&receipt).unwrap());
}

#[derive(Debug, Deserialize)]
struct ApiEnvelope<T> {
    success: bool,
    message: String,
    data: T,
}

#[derive(Debug, Deserialize)]
struct LoginData {
    token: String,
    pubkey: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct DealData {
    id: String,
    status: String,
    escrow_address: Option<String>,
    funding_txid: Option<String>,
    funding_vout: Option<i32>,
    funding_amount_sats: Option<i64>,
    settlement_txid: Option<String>,
    current_psbt: Option<String>,
    amount_sats: i64,
}

struct Party {
    sk: SecretKey,
    pubkey: String,
    token: String,
}

struct Bitcoind {
    client: reqwest::Client,
    base_url: String,
}

impl Bitcoind {
    fn new(base_url: &str) -> Self {
        return Bitcoind {
            client: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
        };
    }

    async fn call(&self, wallet: Option<&str>, method: &str, params: Value) -> Result<Value> {
        let url = match wallet {
            Some(name) => format!("{}/wallet/{}", self.base_url, name),
            None => self.base_url.clone(),
        };
        let body = json!({
            "jsonrpc": "1.0",
            "id": "opendeal-live-e2e",
            "method": method,
            "params": params,
        });
        let response = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("rpc {method}"))?;
        let value: Value = response.json().await.context("rpc json")?;
        if let Some(err) = value.get("error")
            && !err.is_null()
        {
            let msg = err.to_string();
            if method == "createwallet" && msg.contains("already exists") {
                return Ok(Value::Null);
            }
            bail!("bitcoin rpc {method} error: {err}");
        }
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
}

struct Api {
    client: reqwest::Client,
    base: String,
}

impl Api {
    fn new(base: &str) -> Self {
        return Api {
            client: reqwest::Client::new(),
            base: base.trim_end_matches('/').to_string(),
        };
    }

    async fn post_auth<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: Value,
    ) -> Result<T> {
        let url = format!("{}{}", self.base, path);
        let response = self.client.post(&url).json(&body).send().await?;
        let status = response.status();
        let envelope: ApiEnvelope<T> = response.json().await?;
        if !status.is_success() || !envelope.success {
            bail!("API {path}: {} ({})", envelope.message, status);
        }
        return Ok(envelope.data);
    }

    async fn authed<T: for<'de> Deserialize<'de>>(
        &self,
        method: reqwest::Method,
        path: &str,
        token: &str,
        body: Option<Value>,
    ) -> Result<T> {
        let url = format!("{}{}", self.base, path);
        let mut req = self
            .client
            .request(method, &url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json");
        if let Some(b) = body {
            req = req.json(&b);
        }
        let response = req.send().await?;
        let status = response.status();
        let envelope: ApiEnvelope<T> = response.json().await.context("api envelope")?;
        if !status.is_success() || !envelope.success {
            bail!("API {path}: {} ({})", envelope.message, status);
        }
        return Ok(envelope.data);
    }

    async fn get_public<T: for<'de> Deserialize<'de>>(&self, path: &str) -> Result<T> {
        let url = format!("{}{}", self.base, path);
        let response = self.client.get(&url).send().await?;
        let status = response.status();
        let envelope: ApiEnvelope<T> = response.json().await?;
        if !status.is_success() || !envelope.success {
            bail!("API {path}: {} ({})", envelope.message, status);
        }
        return Ok(envelope.data);
    }
}

async fn mint_party(api: &Api, sk_bytes: [u8; 32]) -> Result<Party> {
    let secp = Secp256k1::new();
    let sk = SecretKey::from_slice(&sk_bytes).context("secret key")?;
    let pubkey = hex::encode(secp256k1::PublicKey::from_secret_key(&secp, &sk).serialize());
    let login: LoginData = api
        .post_auth(
            "/api/v1/auth/dev/session",
            json!({ "pubkey": pubkey }),
        )
        .await
        .context("dev session (is APP_ENV=development and API up?)")?;
    return Ok(Party {
        sk,
        pubkey: login.pubkey,
        token: login.token,
    });
}

async fn run_live_e2e(
    api_url: &str,
    bitcoin_rpc_url: &str,
    amount_sats: u64,
    fee_sats: u64,
    receipt_out: PathBuf,
) -> Result<()> {
    println!("== OpenDeal live regtest e2e ==");
    println!("api={api_url}");
    println!("bitcoind={bitcoin_rpc_url}");

    let api = Api::new(api_url);
    let btc = Bitcoind::new(bitcoin_rpc_url);

    let health = reqwest::Client::new()
        .get(format!("{api_url}/health"))
        .send()
        .await
        .context("API health")?
        .text()
        .await?;
    if health.trim() != "ok" {
        bail!("API not healthy: {health}");
    }

    btc.call(None, "getblockchaininfo", json!([]))
        .await
        .context("bitcoind getblockchaininfo")?;

    let seller = mint_party(&api, [11u8; 32]).await?;
    let buyer = mint_party(&api, [22u8; 32]).await?;
    let mediator = mint_party(&api, [33u8; 32]).await?;
    println!(
        "parties seller={}… buyer={}… mediator={}…",
        &seller.pubkey[..8],
        &buyer.pubkey[..8],
        &mediator.pubkey[..8]
    );

    let wallet = "opendeal_funder";
    let _ = btc
        .call(None, "createwallet", json!([wallet, false, false, "", false, true]))
        .await;
    let _ = btc
        .call(None, "loadwallet", json!([wallet]))
        .await;

    let mine_addr = btc
        .call(Some(wallet), "getnewaddress", json!([]))
        .await?
        .as_str()
        .context("mine address")?
        .to_string();
    btc.call(None, "generatetoaddress", json!([101, mine_addr]))
        .await
        .context("mine 101")?;

    let payout_addr = btc
        .call(Some(wallet), "getnewaddress", json!(["seller_payout"]))
        .await?
        .as_str()
        .context("payout address")?
        .to_string();

    let deadline = (Utc::now() + ChronoDuration::days(3)).to_rfc3339();
    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            "/api/v1/deals",
            &seller.token,
            Some(json!({
                "title": "Used laptop (live e2e)",
                "amount_sats": amount_sats,
                "buyer_pubkey": buyer.pubkey,
                "mediator_pubkey": mediator.pubkey,
                "delivery_deadline": deadline,
                "acceptance_window_hours": 48,
            })),
        )
        .await
        .context("create deal")?;
    println!("deal created id={} status={}", deal.id, deal.status);

    #[derive(Deserialize)]
    struct AgreementView {
        canonical_hex: String,
    }
    let view: AgreementView = api
        .get_public(&format!("/api/v1/deals/{}/agreement", deal.id))
        .await?;
    let canonical = hex::decode(&view.canonical_hex).context("canonical hex")?;
    let sig_seller = sign_bytes(&seller.sk, &canonical);
    let sig_buyer = sign_bytes(&buyer.sk, &canonical);

    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            &format!("/api/v1/deals/{}/sign", deal.id),
            &seller.token,
            Some(json!({ "signature": sig_seller })),
        )
        .await
        .context("seller sign")?;
    println!("seller signed → status={}", deal.status);

    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            &format!("/api/v1/deals/{}/sign", deal.id),
            &buyer.token,
            Some(json!({ "signature": sig_buyer })),
        )
        .await
        .context("buyer sign")?;
    println!("buyer signed → status={}", deal.status);
    if deal.status != "agreed" {
        bail!("expected agreed after dual-sign, got {}", deal.status);
    }

    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            &format!("/api/v1/deals/{}/funding/prepare", deal.id),
            &seller.token,
            None,
        )
        .await
        .context("prepare funding")?;
    let escrow = deal
        .escrow_address
        .clone()
        .context("escrow_address missing")?;
    println!("escrow={escrow}");

    let amount_btc = amount_sats as f64 / 100_000_000.0;
    let fund_txid = btc
        .call(
            Some(wallet),
            "sendtoaddress",
            json!([escrow, amount_btc]),
        )
        .await
        .context("sendtoaddress escrow")?
        .as_str()
        .context("fund txid")?
        .to_string();
    println!("funded txid={fund_txid}");
    btc.call(None, "generatetoaddress", json!([1, mine_addr]))
        .await
        .context("confirm funding")?;

    let mut deal = deal;
    for attempt in 1..=10 {
        tokio::time::sleep(Duration::from_millis(400)).await;
        deal = api
            .authed(
                reqwest::Method::POST,
                &format!("/api/v1/deals/{}/funding/verify", deal.id),
                &buyer.token,
                None,
            )
            .await
            .with_context(|| format!("verify funding attempt {attempt}"))?;
        if deal.status == "funded" {
            break;
        }
        println!(
            "verify attempt {attempt}: status={} funding_txid={:?}",
            deal.status, deal.funding_txid
        );
    }
    if deal.status != "funded" {
        bail!("deal not funded after retries; status={}", deal.status);
    }
    println!(
        "funded confirmed txid={:?} vout={:?}",
        deal.funding_txid, deal.funding_vout
    );

    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            &format!("/api/v1/deals/{}/transition", deal.id),
            &seller.token,
            Some(json!({ "to": "shipped" })),
        )
        .await
        .context("ship")?;
    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            &format!("/api/v1/deals/{}/transition", deal.id),
            &buyer.token,
            Some(json!({ "to": "accepted" })),
        )
        .await
        .context("accept")?;
    println!("status after accept={}", deal.status);

    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            &format!("/api/v1/deals/{}/settlement/propose", deal.id),
            &seller.token,
            Some(json!({
                "destination_address": payout_addr,
                "fee_sats": fee_sats,
                "purpose": "payout_seller",
            })),
        )
        .await
        .context("propose settlement")?;
    let psbt = deal.current_psbt.clone().context("current_psbt")?;
    println!("settlement PSBT proposed ({} chars)", psbt.len());

    let bitcoin_sk_seller = bitcoin::secp256k1::SecretKey::from_slice(seller.sk.as_ref())
        .map_err(|e| anyhow::anyhow!(e))?;
    let bitcoin_sk_buyer = bitcoin::secp256k1::SecretKey::from_slice(buyer.sk.as_ref())
        .map_err(|e| anyhow::anyhow!(e))?;
    let signed_seller = sign_psbt_with_secret(&psbt, &bitcoin_sk_seller)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let signed_buyer = sign_psbt_with_secret(&psbt, &bitcoin_sk_buyer)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            &format!("/api/v1/deals/{}/settlement/sign", deal.id),
            &seller.token,
            Some(json!({ "signed_psbt": signed_seller })),
        )
        .await
        .context("attach seller psbt")?;
    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            &format!("/api/v1/deals/{}/settlement/sign", deal.id),
            &buyer.token,
            Some(json!({ "signed_psbt": signed_buyer })),
        )
        .await
        .context("attach buyer psbt")?;

    let deal: DealData = api
        .authed(
            reqwest::Method::POST,
            &format!("/api/v1/deals/{}/settlement/finalize", deal.id),
            &seller.token,
            None,
        )
        .await
        .context("finalize settlement")?;
    println!(
        "settled status={} settlement_txid={:?}",
        deal.status, deal.settlement_txid
    );
    if deal.status != "settled" {
        bail!("expected settled, got {}", deal.status);
    }

    btc.call(None, "generatetoaddress", json!([1, mine_addr]))
        .await
        .ok();

    let receipt: DealReceipt = api
        .get_public(&format!("/api/v1/deals/{}/receipt", deal.id))
        .await
        .context("export receipt")?;
    receipt.verify().context("receipt.verify")?;
    let pretty = serde_json::to_string_pretty(&receipt)?;
    std::fs::write(&receipt_out, &pretty).context("write receipt")?;
    println!("receipt written to {}", receipt_out.display());
    println!("receipt ok: {}", receipt.agreement_id);
    println!("== live-e2e SUCCESS ==");
    return Ok(());
}
