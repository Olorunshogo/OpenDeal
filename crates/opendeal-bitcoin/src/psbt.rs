use std::collections::BTreeMap;
use std::str::FromStr;

use bitcoin::absolute::LockTime;
use bitcoin::bip32::KeySource;
use bitcoin::consensus::encode::serialize_hex;
use bitcoin::hashes::Hash;
use bitcoin::psbt::{Input as PsbtInput, Psbt, PsbtSighashType};
use bitcoin::secp256k1::{Message, PublicKey, Secp256k1, SecretKey};
use bitcoin::sighash::{EcdsaSighashType, SighashCache};
use bitcoin::transaction::{OutPoint, Transaction, TxIn, TxOut, Version};
use bitcoin::{Address, Amount, ScriptBuf, Sequence, Txid, WScriptHash, Witness};
use serde::{Deserialize, Serialize};

use crate::error::BitcoinError;
use crate::escrow::{EscrowDescriptor, parse_network};
use crate::policy::FeeDustPolicy;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettlementPurpose {
    /// Pay the seller (happy path).
    PayoutSeller,
    /// Refund the buyer (cancel / mediator-assisted refund).
    RefundBuyer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettlementPsbt {
    pub purpose: SettlementPurpose,
    pub psbt_base64: String,
    pub unsigned_txid: String,
    pub output_address: String,
    pub output_amount_sats: u64,
    pub fee_sats: u64,
}

/**
 * Builds an unsigned PSBT spending a single confirmed escrow UTXO to `destination` after fee.
 * Callers attach signatures externally; the API only stores and combines PSBT updates.
 */
#[allow(clippy::too_many_arguments)]
pub fn build_settlement_psbt(
    escrow: &EscrowDescriptor,
    funding_txid: &str,
    funding_vout: u32,
    funding_amount_sats: u64,
    destination_address: &str,
    fee_sats: u64,
    purpose: SettlementPurpose,
) -> Result<SettlementPsbt, BitcoinError> {
    let output_amount =
        FeeDustPolicy::default().validate_settlement_amounts(funding_amount_sats, fee_sats)?;

    let network = parse_network(&escrow.network)?;
    let txid = Txid::from_str(funding_txid).map_err(|e| BitcoinError::Psbt(e.to_string()))?;
    let dest = Address::from_str(destination_address)
        .map_err(|e| BitcoinError::Psbt(e.to_string()))?
        .require_network(network)
        .map_err(|e| BitcoinError::NetworkMismatch {
            expected: escrow.network.clone(),
            got: e.to_string(),
        })?;

    let witness_script = ScriptBuf::from_bytes(
        hex::decode(&escrow.witness_script_hex).map_err(|e| BitcoinError::Script(e.to_string()))?,
    );
    let script_pubkey = ScriptBuf::from_bytes(
        hex::decode(&escrow.script_pubkey_hex).map_err(|e| BitcoinError::Script(e.to_string()))?,
    );
    if script_pubkey != ScriptBuf::new_p2wsh(&WScriptHash::hash(witness_script.as_bytes())) {
        return Err(BitcoinError::Script(
            "escrow script_pubkey does not match witness_script".into(),
        ));
    }

    let tx = Transaction {
        version: Version::TWO,
        lock_time: LockTime::ZERO,
        input: vec![TxIn {
            previous_output: OutPoint {
                txid,
                vout: funding_vout,
            },
            script_sig: ScriptBuf::new(),
            sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
            witness: Witness::new(),
        }],
        output: vec![TxOut {
            value: Amount::from_sat(output_amount),
            script_pubkey: dest.script_pubkey(),
        }],
    };

    let mut psbt = Psbt::from_unsigned_tx(tx).map_err(|e| BitcoinError::Psbt(e.to_string()))?;

    let mut bip32_derivation: BTreeMap<PublicKey, KeySource> = BTreeMap::new();
    for pk_hex in &escrow.sorted_pubkeys {
        let pk = PublicKey::from_slice(
            &hex::decode(pk_hex).map_err(|e| BitcoinError::InvalidKey(e.to_string()))?,
        )
        .map_err(|e| BitcoinError::InvalidKey(e.to_string()))?;
        // Empty derivation path. Parties are single keys, not HD paths in the MVP.
        bip32_derivation.insert(pk, Default::default());
    }

    psbt.inputs[0] = PsbtInput {
        witness_utxo: Some(TxOut {
            value: Amount::from_sat(funding_amount_sats),
            script_pubkey,
        }),
        witness_script: Some(witness_script),
        sighash_type: Some(PsbtSighashType::from(
            bitcoin::sighash::EcdsaSighashType::All,
        )),
        bip32_derivation,
        ..Default::default()
    };

    let unsigned_txid = psbt.unsigned_tx.compute_txid().to_string();
    let psbt_base64 = psbt_to_base64(&psbt)?;

    return Ok(SettlementPsbt {
        purpose,
        psbt_base64,
        unsigned_txid,
        output_address: destination_address.to_string(),
        output_amount_sats: output_amount,
        fee_sats,
    });
}

pub fn psbt_to_base64(psbt: &Psbt) -> Result<String, BitcoinError> {
    use base64::Engine;
    let bytes = psbt.serialize();
    return Ok(base64::engine::general_purpose::STANDARD.encode(bytes));
}

pub fn psbt_from_base64(data: &str) -> Result<Psbt, BitcoinError> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| BitcoinError::Psbt(e.to_string()))?;
    return Psbt::deserialize(&bytes).map_err(|e| BitcoinError::Psbt(e.to_string()));
}

/// Combines two PSBTs that share the same unsigned tx (partial sig aggregation helper).
pub fn combine_psbts(base: &str, update: &str) -> Result<String, BitcoinError> {
    let mut a = psbt_from_base64(base)?;
    let b = psbt_from_base64(update)?;
    if a.unsigned_tx.compute_txid() != b.unsigned_tx.compute_txid() {
        return Err(BitcoinError::Psbt(
            "cannot combine PSBTs with different unsigned transactions".into(),
        ));
    }
    if a.inputs.len() != 1 || b.inputs.len() != 1 {
        return Err(BitcoinError::Psbt(
            "expected single-input settlement PSBTs".into(),
        ));
    }
    a.combine(b)
        .map_err(|e| BitcoinError::Psbt(e.to_string()))?;
    return psbt_to_base64(&a);
}

pub fn sign_psbt_with_secret(
    psbt_base64: &str,
    secret: &SecretKey,
) -> Result<String, BitcoinError> {
    let mut psbt = psbt_from_base64(psbt_base64)?;
    if psbt.inputs.len() != 1 {
        return Err(BitcoinError::Psbt(
            "expected single-input settlement PSBT".into(),
        ));
    }
    let secp = Secp256k1::new();
    let pubkey = PublicKey::from_secret_key(&secp, secret);
    let bitcoin_pk = bitcoin::PublicKey::new(pubkey);

    let witness_utxo = psbt.inputs[0]
        .witness_utxo
        .clone()
        .ok_or_else(|| BitcoinError::Psbt("missing witness_utxo".into()))?;
    let witness_script = psbt.inputs[0]
        .witness_script
        .clone()
        .ok_or_else(|| BitcoinError::Psbt("missing witness_script".into()))?;
    let sighash_type = EcdsaSighashType::All;

    let mut cache = SighashCache::new(&psbt.unsigned_tx);
    let sighash = cache
        .p2wsh_signature_hash(0, &witness_script, witness_utxo.value, sighash_type)
        .map_err(|e| BitcoinError::Psbt(e.to_string()))?;
    let msg = Message::from_digest_slice(sighash.as_ref())
        .map_err(|e| BitcoinError::Psbt(e.to_string()))?;
    let sig = secp.sign_ecdsa(&msg, secret);
    let mut der = sig.serialize_der().to_vec();
    der.push(sighash_type as u8);
    let ecdsa_sig = bitcoin::ecdsa::Signature::from_slice(&der)
        .map_err(|e| BitcoinError::Psbt(e.to_string()))?;
    psbt.inputs[0].partial_sigs.insert(bitcoin_pk, ecdsa_sig);
    return psbt_to_base64(&psbt);
}

pub fn finalize_2of3_psbt(psbt_base64: &str) -> Result<String, BitcoinError> {
    let mut psbt = psbt_from_base64(psbt_base64)?;
    if psbt.inputs.len() != 1 {
        return Err(BitcoinError::Psbt(
            "expected single-input settlement PSBT".into(),
        ));
    }
    if psbt.inputs[0].final_script_witness.is_some() {
        return psbt_to_base64(&psbt);
    }
    let witness_script = psbt.inputs[0]
        .witness_script
        .clone()
        .ok_or_else(|| BitcoinError::Psbt("missing witness_script".into()))?;
    let script_pubkeys = multisig_pubkeys_from_script(&witness_script)?;
    let partial = &psbt.inputs[0].partial_sigs;
    let mut ordered_sigs = Vec::new();
    for pk in &script_pubkeys {
        if let Some(sig) = partial.get(pk) {
            ordered_sigs.push(*sig);
        }
    }
    if ordered_sigs.len() < 2 {
        return Err(BitcoinError::Psbt(format!(
            "need 2-of-3 signatures to finalize, have {}",
            ordered_sigs.len()
        )));
    }
    ordered_sigs.truncate(2);
    for sig in &ordered_sigs {
        let bytes = sig.to_vec();
        let sighash = bytes.last().copied().unwrap_or(0xff);
        if sighash != EcdsaSighashType::All as u8 {
            return Err(BitcoinError::Psbt(
                "settlement signatures must use SIGHASH_ALL".into(),
            ));
        }
    }

    let mut witness = Witness::new();
    witness.push([]);
    for sig in &ordered_sigs {
        witness.push(sig.to_vec());
    }
    witness.push(witness_script.as_bytes());
    psbt.inputs[0].final_script_witness = Some(witness);
    psbt.inputs[0].partial_sigs.clear();
    psbt.inputs[0].sighash_type = None;
    return psbt_to_base64(&psbt);
}

fn multisig_pubkeys_from_script(
    script: &ScriptBuf,
) -> Result<Vec<bitcoin::PublicKey>, BitcoinError> {
    let bytes = script.as_bytes();
    if bytes.len() < 3 + 3 * 34 || bytes[0] != 0x52 {
        return Err(BitcoinError::Script("not a 2-of-3 multisig script".into()));
    }
    let mut keys = Vec::new();
    let mut i = 1usize;
    for _ in 0..3 {
        if i >= bytes.len() || bytes[i] != 33 {
            return Err(BitcoinError::Script("expected 33-byte pubkey push".into()));
        }
        i += 1;
        let pk = bitcoin::PublicKey::from_slice(&bytes[i..i + 33])
            .map_err(|e| BitcoinError::InvalidKey(e.to_string()))?;
        keys.push(pk);
        i += 33;
    }
    return Ok(keys);
}

/// Extracts a finalized transaction hex when the PSBT has a complete witness.
pub fn extract_tx_hex(psbt_base64: &str) -> Result<String, BitcoinError> {
    let finalized = finalize_2of3_psbt(psbt_base64).unwrap_or_else(|_| psbt_base64.to_string());
    let psbt = psbt_from_base64(&finalized)?;
    let tx = psbt
        .extract_tx()
        .map_err(|e| BitcoinError::Psbt(format!("extract failed (need 2-of-3 sigs): {}", e)))?;
    return Ok(serialize_hex(&tx));
}

/// Validate external partial signatures against server-owned PSBT metadata.
/// Client final witnesses and alternate sighash types are deliberately not accepted.
pub fn validated_combine(base: &str, update: &str) -> Result<String, BitcoinError> {
    let mut trusted = psbt_from_base64(base)?;
    let submitted = psbt_from_base64(update)?;
    if trusted.unsigned_tx != submitted.unsigned_tx
        || trusted.inputs.len() != 1
        || submitted.inputs.len() != 1
    {
        return Err(BitcoinError::Psbt("unsigned transaction changed".into()));
    }
    let input = &submitted.inputs[0];
    if input.final_script_witness.is_some()
        || input.final_script_sig.is_some()
        || input.witness_utxo != trusted.inputs[0].witness_utxo
        || input.witness_script != trusted.inputs[0].witness_script
        || input.ecdsa_hash_ty().ok() != Some(bitcoin::sighash::EcdsaSighashType::All)
    {
        return Err(BitcoinError::Psbt(
            "untrusted input metadata or finalized witness".into(),
        ));
    }
    // Copy only signature entries; derivation paths, proprietary fields and output
    // metadata from untrusted signers are never persisted.
    trusted.inputs[0]
        .partial_sigs
        .extend(input.partial_sigs.clone());
    validate_partial_signatures(&trusted)?;
    psbt_to_base64(&trusted)
}

pub fn validate_partial_signatures(psbt: &Psbt) -> Result<usize, BitcoinError> {
    use bitcoin::hashes::Hash;
    use bitcoin::secp256k1::{Message, Secp256k1};
    use bitcoin::sighash::{EcdsaSighashType, SighashCache};
    let fail = || BitcoinError::Psbt("invalid escrow PSBT or signature".into());
    if psbt.inputs.len() != 1 {
        return Err(fail());
    }
    let input = &psbt.inputs[0];
    let script = input.witness_script.as_ref().ok_or_else(fail)?;
    let utxo = input.witness_utxo.as_ref().ok_or_else(fail)?;
    if script.to_p2wsh() != utxo.script_pubkey
        || input.ecdsa_hash_ty().ok() != Some(EcdsaSighashType::All)
    {
        return Err(fail());
    }
    // OpenDeal's fixed script is OP_2, three compressed pubkey pushes, OP_3, CHECKMULTISIG.
    let bytes = script.as_bytes();
    if bytes.len() != 105 || bytes[0] != 0x52 || bytes[103..] != [0x53, 0xae] {
        return Err(fail());
    }
    let mut keys = Vec::new();
    for offset in [1, 35, 69] {
        if bytes[offset] != 33 {
            return Err(fail());
        }
        keys.push(
            bitcoin::PublicKey::from_slice(&bytes[offset + 1..offset + 34]).map_err(|_| fail())?,
        );
    }
    if !keys
        .windows(2)
        .all(|pair| pair[0].to_bytes() < pair[1].to_bytes())
    {
        return Err(fail());
    }
    let hash = SighashCache::new(&psbt.unsigned_tx)
        .p2wsh_signature_hash(0, script, utxo.value, EcdsaSighashType::All)
        .map_err(|_| fail())?;
    let message = Message::from_digest(hash.to_byte_array());
    let secp = Secp256k1::verification_only();
    for (key, sig) in &input.partial_sigs {
        if !keys.contains(key) || sig.sighash_type != EcdsaSighashType::All {
            return Err(fail());
        }
        secp.verify_ecdsa(&message, &sig.signature, &key.inner)
            .map_err(|_| fail())?;
    }
    Ok(input.partial_sigs.len())
}

/// Finalize only cryptographically valid signatures; no signing key enters this function.
pub fn finalize_validated(base: &str) -> Result<String, BitcoinError> {
    let mut psbt = psbt_from_base64(base)?;
    if validate_partial_signatures(&psbt)? < 2 {
        return Err(BitcoinError::Psbt(
            "two valid escrow signatures are required".into(),
        ));
    }
    let input = &mut psbt.inputs[0];
    let script = input
        .witness_script
        .clone()
        .ok_or_else(|| BitcoinError::Psbt("missing script".into()))?;
    let mut witness = Witness::new();
    witness.push([]);
    // BTreeMap uses compressed pubkey ordering, identical to the escrow script.
    for signature in input.partial_sigs.values().take(2) {
        witness.push(signature.to_vec());
    }
    witness.push(script.as_bytes());
    input.final_script_witness = Some(witness);
    input.partial_sigs.clear();
    input.sighash_type = None;
    input.witness_script = None;
    input.bip32_derivation.clear();
    psbt_to_base64(&psbt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::escrow::EscrowKeys;
    use bitcoin::{CompressedPublicKey, Network};

    fn sample_escrow() -> (EscrowDescriptor, SecretKey, SecretKey, String) {
        let secp = Secp256k1::new();
        let sk1 = SecretKey::from_slice(&[1u8; 32]).unwrap();
        let sk2 = SecretKey::from_slice(&[2u8; 32]).unwrap();
        let sk3 = SecretKey::from_slice(&[3u8; 32]).unwrap();
        let pk1 = bitcoin::PublicKey::new(PublicKey::from_secret_key(&secp, &sk1));
        let keys = EscrowKeys {
            seller_pubkey: pk1.to_string(),
            buyer_pubkey: bitcoin::PublicKey::new(PublicKey::from_secret_key(&secp, &sk2))
                .to_string(),
            mediator_pubkey: bitcoin::PublicKey::new(PublicKey::from_secret_key(&secp, &sk3))
                .to_string(),
        };
        let escrow = keys.build_escrow(Network::Regtest).unwrap();
        let cpk = CompressedPublicKey::from_slice(&pk1.to_bytes()).unwrap();
        let dest = Address::p2wpkh(&cpk, Network::Regtest).to_string();
        return (escrow, sk1, sk2, dest);
    }

    #[test]
    fn settlement_roundtrip_needs_two_sigs() {
        let (escrow, sk1, sk2, dest) = sample_escrow();
        let funding = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let psbt = build_settlement_psbt(
            &escrow,
            funding,
            0,
            50_000,
            &dest,
            500,
            SettlementPurpose::PayoutSeller,
        )
        .unwrap();
        assert!(finalize_2of3_psbt(&psbt.psbt_base64).is_err());
        let s1 = sign_psbt_with_secret(&psbt.psbt_base64, &sk1).unwrap();
        let s2 = sign_psbt_with_secret(&psbt.psbt_base64, &sk2).unwrap();
        let combined = combine_psbts(&s1, &s2).unwrap();
        let finalized = finalize_2of3_psbt(&combined).unwrap();
        assert!(extract_tx_hex(&finalized).is_ok());
    }

    #[test]
    fn rejects_destination_on_wrong_network() {
        let (escrow, _, _, _) = sample_escrow();
        let funding = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let mainnet_dest = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
        let err = build_settlement_psbt(
            &escrow,
            funding,
            0,
            50_000,
            mainnet_dest,
            500,
            SettlementPurpose::PayoutSeller,
        );
        assert!(err.is_err());
    }
}
