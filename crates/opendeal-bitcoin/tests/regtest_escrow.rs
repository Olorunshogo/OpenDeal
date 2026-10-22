//! Opt-in, state-changing regtest lifecycle. No API or database access.
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use bitcoin::consensus::encode::{deserialize_hex, serialize_hex};
use bitcoin::hashes::Hash;
use bitcoin::psbt::Psbt;
use bitcoin::secp256k1::{Message, PublicKey, Secp256k1, SecretKey, rand};
use bitcoin::sighash::{EcdsaSighashType, SighashCache};
use bitcoin::{Address, Amount, Denomination, Network, ScriptBuf, Transaction, Witness};
use opendeal_bitcoin::psbt::{extract_tx_hex, psbt_from_base64, psbt_to_base64};
use opendeal_bitcoin::{
    BitcoinMultisigAdapter, BitcoinRpc, EscrowDescriptor, EscrowKeys, HttpBitcoinRpc,
    MockBitcoinRpc, SettlementPurpose,
};
use serde_json::{Value, json};

const FUNDING_SATS: u64 = 100_000;
const FEE_SATS: u64 = 1_000;
const CONFIRMATIONS: u32 = 2;

fn fresh_keys() -> ([SecretKey; 3], EscrowKeys) {
    let secp = Secp256k1::new();
    let secrets = std::array::from_fn(|_| SecretKey::new(&mut rand::thread_rng()));
    let public = secrets.map(|key| PublicKey::from_secret_key(&secp, &key).to_string());
    let keys = EscrowKeys {
        buyer_pubkey: public[0].clone(),
        seller_pubkey: public[1].clone(),
        mediator_pubkey: public[2].clone(),
    };
    (secrets, keys)
}

/// Emulates two external signers and their submitted PSBT updates. No key RPCs.
fn sign_and_finalize(
    adapter: &BitcoinMultisigAdapter,
    escrow: &EscrowDescriptor,
    base: &str,
    buyer: &SecretKey,
    seller: &SecretKey,
) -> Psbt {
    let secp = Secp256k1::new();
    let original = psbt_from_base64(base).expect("decode settlement PSBT");
    assert_eq!(original.inputs.len(), 1);
    let script = original.inputs[0]
        .witness_script
        .clone()
        .expect("witness script");
    let utxo = original.inputs[0]
        .witness_utxo
        .as_ref()
        .expect("witness UTXO");
    assert_eq!(utxo.script_pubkey, script.to_p2wsh());
    assert_eq!(
        hex::encode(utxo.script_pubkey.as_bytes()),
        escrow.script_pubkey_hex
    );
    assert_eq!(utxo.value.to_sat(), FUNDING_SATS);
    let sighash_type = original.inputs[0]
        .ecdsa_hash_ty()
        .expect("ECDSA sighash type");
    assert_eq!(sighash_type, EcdsaSighashType::All);
    // BIP143: use the witness script as scriptCode and the actual previous output amount.
    let sighash = SighashCache::new(&original.unsigned_tx)
        .p2wsh_signature_hash(0, &script, utxo.value, sighash_type)
        .expect("SegWit v0 sighash");
    let message = Message::from_digest(sighash.to_byte_array());
    let mut combined = base.to_owned();
    for secret in [buyer, seller] {
        let public = PublicKey::from_secret_key(&secp, secret);
        let signature = secp.sign_ecdsa(&message, secret);
        secp.verify_ecdsa(&message, &signature, &public)
            .expect("local signature verification");
        let mut update = original.clone();
        update.inputs[0].partial_sigs.insert(
            bitcoin::PublicKey::new(public),
            bitcoin::ecdsa::Signature {
                signature,
                sighash_type,
            },
        );
        combined = adapter
            .attach_signature(
                &combined,
                &psbt_to_base64(&update).expect("encode signer PSBT"),
            )
            .expect("combine independently signed PSBT");
    }
    let mut finalized = psbt_from_base64(&combined).expect("decode combined PSBT");
    assert_eq!(finalized.inputs[0].partial_sigs.len(), 2);
    let mut witness = Witness::new();
    witness.push([]); // CHECKMULTISIG's historical dummy element must be empty.
    for public in &escrow.sorted_pubkeys {
        let public = bitcoin::PublicKey::from_str(public).expect("escrow public key");
        if let Some(signature) = finalized.inputs[0].partial_sigs.get(&public) {
            witness.push(signature.to_vec()); // DER signature followed by SIGHASH_ALL byte.
        }
    }
    assert_eq!(witness.len(), 3, "dummy plus exactly two sorted signatures");
    witness.push(script.as_bytes());
    let input = &mut finalized.inputs[0];
    input.final_script_witness = Some(witness);
    input.partial_sigs.clear();
    input.sighash_type = None;
    input.witness_script = None;
    input.bip32_derivation.clear();
    finalized
}

/// Wallet/mining RPCs exist only in this test harness, keeping BitcoinRpc unchanged.
struct CoreHarness {
    url: reqwest::Url,
    user: String,
    password: String,
    client: reqwest::Client,
}

impl CoreHarness {
    async fn call(&self, method: &str, params: Value) -> Value {
        let response = self.client.post(self.url.clone())
            .basic_auth(&self.user, Some(&self.password))
            .json(&json!({"jsonrpc":"1.0", "id":"opendeal-regtest-test", "method":method, "params":params}))
            .send().await.unwrap_or_else(|_| panic!("{method}: transport/timeout failure"));
        let status = response.status();
        assert!(
            status.as_u16() != 401 && status.as_u16() != 403,
            "{method}: authentication failed; check RPC credentials"
        );
        // Core may use HTTP 500 for JSON-RPC errors. Never echo the response body.
        let value: Value = response.json().await.expect("Core returned invalid JSON");
        assert!(
            value["error"].is_null(),
            "{method}: RPC error code {}",
            value["error"]["code"].as_i64().unwrap_or(0)
        );
        assert!(status.is_success(), "{method}: HTTP {}", status.as_u16());
        value.get("result").cloned().expect("missing RPC result")
    }
}

fn required(name: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| panic!("{name} must be exported for the live regtest test"))
}

fn checked_regtest_address(raw: &str) -> Address {
    Address::from_str(raw)
        .expect("valid address")
        .require_network(Network::Regtest)
        .expect("address must belong to regtest")
}

fn btc_json(sats: u64) -> Value {
    // JSON RPC expects BTC; format from integer satoshis without floating point arithmetic.
    Value::Number(
        serde_json::Number::from_str(&format!("{}.{:08}", sats / 100_000_000, sats % 100_000_000))
            .unwrap(),
    )
}

fn btc_sats(value: &Value) -> u64 {
    Amount::from_str_in(&value.to_string(), Denomination::Bitcoin)
        .expect("exact BTC amount")
        .to_sat()
}

#[tokio::test]
#[ignore = "funds, mines and broadcasts on regtest; requires OPENDEAL_LIVE_REGTEST=1 and RPC wallet credentials"]
async fn live_regtest_escrow_lifecycle() {
    assert_eq!(
        required("OPENDEAL_LIVE_REGTEST"),
        "1",
        "explicit opt-in must equal 1"
    );
    assert_eq!(
        required("BITCOIN_NETWORK"),
        "regtest",
        "only regtest is allowed"
    );
    let raw_url = required("BITCOIN_RPC_URL");
    let mut url = reqwest::Url::parse(&raw_url).expect("valid RPC URL");
    assert!(
        matches!(url.scheme(), "http" | "https"),
        "RPC URL must use HTTP(S)"
    );
    assert!(
        url.username().is_empty() && url.password().is_none(),
        "use separate RPC credentials"
    );
    assert!(
        url.path() == "/" && url.query().is_none() && url.fragment().is_none(),
        "BITCOIN_RPC_URL must be a node root URL; select wallet with BITCOIN_RPC_WALLET"
    );
    let user = required("BITCOIN_RPC_USER");
    let password = required("BITCOIN_RPC_PASSWORD");
    let wallet = required("BITCOIN_RPC_WALLET");
    let mut core = CoreHarness {
        url: url.clone(),
        user: user.clone(),
        password: password.clone(),
        client: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap(),
    };
    // Check the actual node before any state-changing RPC, regardless of environment labels.
    assert_eq!(
        core.call("getblockchaininfo", json!([])).await["chain"].as_str(),
        Some("regtest"),
        "refusing to modify a non-regtest node"
    );
    url.path_segments_mut()
        .expect("HTTP path")
        .pop_if_empty()
        .push("wallet")
        .push(&wallet);
    core.url = url;
    let wallet_info = core.call("getwalletinfo", json!([])).await;
    assert_eq!(
        wallet_info["private_keys_enabled"].as_bool(),
        Some(true),
        "funding wallet must be spend-capable"
    );
    let mining = core
        .call(
            "getnewaddress",
            json!(["opendeal-regtest-mining", "bech32"]),
        )
        .await;
    let mining = checked_regtest_address(mining.as_str().expect("mining address"));
    let destination = core
        .call(
            "getnewaddress",
            json!(["opendeal-regtest-settlement", "bech32"]),
        )
        .await;
    let destination = checked_regtest_address(destination.as_str().expect("destination address"));
    // Bootstrap spendable coinbase funds only when this regtest wallet needs them.
    if btc_sats(&core.call("getbalance", json!([])).await) < FUNDING_SATS + 20_000 {
        core.call("generatetoaddress", json!([101, mining.to_string()]))
            .await;
    }

    let (secrets, keys) = fresh_keys();
    let rpc = Arc::new(HttpBitcoinRpc::new(raw_url, user, password));
    let adapter = BitcoinMultisigAdapter::new(rpc.clone(), CONFIRMATIONS);
    let (escrow, _) = adapter
        .prepare_funding(&keys, "regtest", FUNDING_SATS)
        .expect("build escrow");
    checked_regtest_address(&escrow.address);
    let funding = core
        .call(
            "sendtoaddress",
            json!({
                "address":escrow.address, "amount":btc_json(FUNDING_SATS), "fee_rate":2,
                "subtractfeefromamount":false
            }),
        )
        .await;
    let funding_txid = funding.as_str().expect("funding txid");
    eprintln!("funding_txid={funding_txid}");
    let details = core.call("gettransaction", json!([funding_txid])).await;
    let funding_tx: Transaction = deserialize_hex(details["hex"].as_str().expect("funding hex"))
        .expect("decode funding transaction");
    assert_eq!(funding_tx.compute_txid().to_string(), funding_txid);
    let expected_script =
        ScriptBuf::from_hex(&escrow.script_pubkey_hex).expect("escrow scriptPubKey");
    let matching: Vec<_> = funding_tx
        .output
        .iter()
        .enumerate()
        .filter(|(_, output)| output.script_pubkey == expected_script)
        .collect();
    assert_eq!(
        matching.len(),
        1,
        "one funding output must match escrow script"
    );
    let (vout, output) = matching[0];
    assert_eq!(output.value.to_sat(), FUNDING_SATS);
    let vout = u32::try_from(vout).expect("funding vout");
    core.call(
        "generatetoaddress",
        json!([CONFIRMATIONS, mining.to_string()]),
    )
    .await;
    let status = adapter
        .verify_funding(&escrow, FUNDING_SATS)
        .await
        .expect("verify escrow funding");
    assert!(status.funded && status.script_matches);
    assert_eq!(status.txid.as_deref(), Some(funding_txid));
    assert_eq!(status.vout, Some(vout));
    assert_eq!(status.amount_sats, Some(FUNDING_SATS));
    assert!(status.confirmations >= CONFIRMATIONS);
    let utxo = rpc
        .get_tx_out(funding_txid, vout)
        .await
        .expect("get funding UTXO")
        .expect("unspent escrow output");
    assert_eq!(utxo.script_pubkey_hex, escrow.script_pubkey_hex);
    assert_eq!(utxo.amount_sats, FUNDING_SATS);
    assert!(utxo.confirmations >= CONFIRMATIONS);

    let proposal = adapter
        .propose_settlement(
            &escrow,
            funding_txid,
            vout,
            FUNDING_SATS,
            &destination.to_string(),
            FEE_SATS,
            SettlementPurpose::PayoutSeller,
        )
        .expect("build settlement PSBT");
    assert_eq!(proposal.output_amount_sats, FUNDING_SATS - FEE_SATS);
    let psbt = sign_and_finalize(
        &adapter,
        &escrow,
        &proposal.psbt_base64,
        &secrets[0],
        &secrets[1],
    );
    let finalized = psbt_to_base64(&psbt).expect("encode final PSBT");
    let tx: Transaction =
        deserialize_hex(&extract_tx_hex(&finalized).expect("extract finalized transaction"))
            .expect("decode settlement");
    assert_eq!(tx.output.len(), 1);
    assert_eq!(tx.output[0].script_pubkey, destination.script_pubkey());
    assert_eq!(FUNDING_SATS - tx.output[0].value.to_sat(), FEE_SATS);
    assert_eq!(tx.input[0].witness.len(), 4);
    // Core independently checks scripts, signatures, fees and policy before broadcast.
    let acceptance = core
        .call("testmempoolaccept", json!([[serialize_hex(&tx)]]))
        .await;
    assert_eq!(
        acceptance[0]["allowed"].as_bool(),
        Some(true),
        "Core rejected finalized settlement"
    );
    let settlement_txid = adapter
        .finalize_and_broadcast(&finalized)
        .await
        .expect("broadcast settlement via authenticated client");
    assert_eq!(settlement_txid, tx.compute_txid().to_string());
    eprintln!("settlement_txid={settlement_txid} settlement_fee_sats={FEE_SATS}");
    let blocks = core
        .call("generatetoaddress", json!([1, mining.to_string()]))
        .await;
    let blockhash = blocks[0].as_str().expect("mined settlement block");
    // Explicit block hash works without txindex, including for non-wallet inputs.
    let confirmed = core
        .call(
            "getrawtransaction",
            json!([settlement_txid, true, blockhash]),
        )
        .await;
    assert_eq!(confirmed["in_active_chain"].as_bool(), Some(true));
    assert!(
        confirmed["confirmations"]
            .as_u64()
            .expect("settlement confirmations")
            >= 1
    );
    let confirmed_tx: Transaction =
        deserialize_hex(confirmed["hex"].as_str().expect("confirmed hex"))
            .expect("decode confirmed settlement");
    assert_eq!(confirmed_tx, tx);
    assert!(
        rpc.get_tx_out(funding_txid, vout)
            .await
            .expect("spent escrow check")
            .is_none()
    );
    let settled = rpc
        .get_tx_out(&settlement_txid, 0)
        .await
        .expect("settlement UTXO")
        .expect("unspent settlement output");
    assert_eq!(settled.amount_sats, FUNDING_SATS - FEE_SATS);
    assert_eq!(
        settled.script_pubkey_hex,
        hex::encode(destination.script_pubkey().as_bytes())
    );
    assert!(settled.confirmations >= 1);
    let funding_fee =
        bitcoin::SignedAmount::from_str_in(&details["fee"].to_string(), Denomination::Bitcoin)
            .expect("funding wallet fee")
            .to_sat()
            .checked_neg()
            .expect("funding fee magnitude");
    assert!(funding_fee > 0);
    eprintln!(
        "PASS funding_txid={funding_txid}:{vout} funding_sats={FUNDING_SATS} funding_fee_sats={funding_fee} funding_confirmations={} settlement_txid={settlement_txid} settlement_fee_sats={FEE_SATS} output_sats={} settlement_confirmations={}",
        status.confirmations, settled.amount_sats, settled.confirmations
    );
}

#[test]
fn offline_signing_finalization_and_network_validation() {
    let (secrets, keys) = fresh_keys();
    let adapter = BitcoinMultisigAdapter::new(Arc::new(MockBitcoinRpc::new()), 1);
    let (escrow, _) = adapter
        .prepare_funding(&keys, "regtest", FUNDING_SATS)
        .unwrap();
    let destination = checked_regtest_address(&escrow.address);
    let proposal = adapter
        .propose_settlement(
            &escrow,
            &"ab".repeat(32),
            0,
            FUNDING_SATS,
            &destination.to_string(),
            FEE_SATS,
            SettlementPurpose::PayoutSeller,
        )
        .unwrap();
    let psbt = sign_and_finalize(
        &adapter,
        &escrow,
        &proposal.psbt_base64,
        &secrets[0],
        &secrets[1],
    );
    let tx: Transaction =
        deserialize_hex(&extract_tx_hex(&psbt_to_base64(&psbt).unwrap()).unwrap()).unwrap();
    assert_eq!(tx.input[0].witness.len(), 4);
    assert!(tx.input[0].witness.iter().next().unwrap().is_empty());
    assert_eq!(
        tx.input[0].witness.iter().last().unwrap(),
        hex::decode(&escrow.witness_script_hex).unwrap()
    );
    assert_eq!(tx.output[0].value.to_sat(), FUNDING_SATS - FEE_SATS);
    // Independently verify the serialized witness signatures against script key order.
    let script = ScriptBuf::from_hex(&escrow.witness_script_hex).unwrap();
    let sighash = SighashCache::new(&tx)
        .p2wsh_signature_hash(
            0,
            &script,
            Amount::from_sat(FUNDING_SATS),
            EcdsaSighashType::All,
        )
        .unwrap();
    let message = Message::from_digest(sighash.to_byte_array());
    let secp = Secp256k1::new();
    let mut signers = [
        PublicKey::from_secret_key(&secp, &secrets[0]),
        PublicKey::from_secret_key(&secp, &secrets[1]),
    ];
    signers.sort_by_key(PublicKey::serialize);
    for (raw_signature, public) in tx.input[0].witness.iter().skip(1).take(2).zip(signers) {
        let signature = bitcoin::ecdsa::Signature::from_slice(raw_signature).unwrap();
        assert_eq!(signature.sighash_type, EcdsaSighashType::All);
        secp.verify_ecdsa(&message, &signature.signature, &public)
            .unwrap();
        let wrong_amount = SighashCache::new(&tx)
            .p2wsh_signature_hash(
                0,
                &script,
                Amount::from_sat(FUNDING_SATS + 1),
                EcdsaSighashType::All,
            )
            .unwrap();
        assert!(
            secp.verify_ecdsa(
                &Message::from_digest(wrong_amount.to_byte_array()),
                &signature.signature,
                &public
            )
            .is_err()
        );
    }
    let mainnet = Address::from_script(&destination.script_pubkey(), Network::Bitcoin).unwrap();
    assert!(
        adapter
            .propose_settlement(
                &escrow,
                &"ab".repeat(32),
                0,
                FUNDING_SATS,
                &mainnet.to_string(),
                FEE_SATS,
                SettlementPurpose::PayoutSeller
            )
            .is_err()
    );
}

#[test]
fn rpc_amounts_preserve_integer_satoshis() {
    for sats in [0, 1, 282, FUNDING_SATS, 100_000_000] {
        let encoded = btc_json(sats).to_string();
        let decoded: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(btc_sats(&decoded), sats);
    }
    let fee: Value = serde_json::from_str("-0.00000282").unwrap();
    assert_eq!(
        bitcoin::SignedAmount::from_str_in(&fee.to_string(), Denomination::Bitcoin)
            .unwrap()
            .to_sat(),
        -282
    );
}
