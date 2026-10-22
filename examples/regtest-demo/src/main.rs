//! Offline protocol demo: create agreement, dual-sign, build 2-of-3 address, emit receipt JSON.
//! For full bitcoind funding/PSBT, point BITCOIN_RPC_URL at regtest and use the API + wallets.

#![allow(clippy::needless_return, clippy::uninlined_format_args)]

use chrono::{Duration, Utc};
use clap::{Parser, Subcommand};
use opendeal_bitcoin::escrow::parse_network;
use opendeal_bitcoin::{EscrowKeys, SettlementPurpose};
use opendeal_core::{
    Agreement, DealEvent, DealReceipt, DealStatus, EventKind, EventPayload, SettlementModel,
    sign_bytes, verify_agreement_signature, verify_event_chain,
};
use secp256k1::{Secp256k1, SecretKey};

#[derive(Parser)]
#[command(name = "regtest-demo", about = "OpenDeal protocol demo helpers")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Print a signed agreement + escrow address + verifiable receipt skeleton.
    LaptopSale,
    /// Verify a receipt JSON file offline.
    VerifyReceipt { path: String },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::LaptopSale => run_laptop_sale(),
        Commands::VerifyReceipt { path } => {
            let raw = std::fs::read_to_string(&path).expect("read receipt");
            let receipt: DealReceipt = serde_json::from_str(&raw).expect("parse receipt");
            receipt.verify().expect("receipt invalid");
            println!("receipt ok: {}", receipt.agreement_id);
        }
    }
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
        title: "Used laptop".into(),
        amount_sats: 50_000,
        currency: "BTC".into(),
        seller_pubkey: seller.clone(),
        buyer_pubkey: buyer.clone(),
        mediator_pubkey: mediator.clone(),
        delivery_deadline: Utc::now() + Duration::days(3),
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
        EventKind::StatusTransitioned,
        EventPayload::StatusTransitioned {
            from: DealStatus::Draft,
            to: DealStatus::Agreed,
        },
        agreement.buyer_pubkey.clone(),
        h0,
        Utc::now(),
    ));
    verify_event_chain(&events).expect("chain");

    let receipt = DealReceipt {
        agreement: agreement.clone(),
        agreement_id: agreement_id.clone(),
        status: DealStatus::Agreed,
        settlement_model: SettlementModel::BitcoinMultisig2of3,
        network: "regtest".into(),
        agreement_signatures: vec![sig_seller, sig_buyer],
        events,
        funding_txid: None,
        settlement_txid: None,
    };
    receipt.verify().expect("receipt");

    println!("agreement_id={}", agreement_id);
    println!("escrow_address={}", escrow.address);
    println!("settlement_model={}", SettlementModel::BitcoinMultisig2of3);
    println!(
        "settlement_purpose_demo={:?}",
        SettlementPurpose::PayoutSeller
    );
    println!("{}", receipt.to_pretty_json().unwrap());
}
