use std::collections::BTreeMap;
use std::str::FromStr;

use bitcoin::absolute::LockTime;
use bitcoin::bip32::KeySource;
use bitcoin::consensus::encode::serialize_hex;
use bitcoin::psbt::{Input as PsbtInput, Psbt, PsbtSighashType};
use bitcoin::secp256k1::PublicKey;
use bitcoin::transaction::{OutPoint, Transaction, TxIn, TxOut, Version};
use bitcoin::{Address, Amount, ScriptBuf, Sequence, Txid, Witness};
use serde::{Deserialize, Serialize};

use crate::error::BitcoinError;
use crate::escrow::EscrowDescriptor;

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
    if fee_sats >= funding_amount_sats {
        return Err(BitcoinError::Psbt(
            "fee must be less than funding amount".into(),
        ));
    }
    let output_amount = funding_amount_sats - fee_sats;

    let txid = Txid::from_str(funding_txid).map_err(|e| BitcoinError::Psbt(e.to_string()))?;
    let dest = Address::from_str(destination_address)
        .map_err(|e| BitcoinError::Psbt(e.to_string()))?
        .assume_checked();

    let witness_script = ScriptBuf::from_bytes(
        hex::decode(&escrow.witness_script_hex).map_err(|e| BitcoinError::Script(e.to_string()))?,
    );
    let script_pubkey = ScriptBuf::from_bytes(
        hex::decode(&escrow.script_pubkey_hex).map_err(|e| BitcoinError::Script(e.to_string()))?,
    );

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
    a.combine(b)
        .map_err(|e| BitcoinError::Psbt(e.to_string()))?;
    return psbt_to_base64(&a);
}

/// Extracts a finalized transaction hex when the PSBT has a complete witness.
pub fn extract_tx_hex(psbt_base64: &str) -> Result<String, BitcoinError> {
    let psbt = psbt_from_base64(psbt_base64)?;
    let tx = psbt
        .extract_tx()
        .map_err(|e| BitcoinError::Psbt(format!("extract failed (need 2-of-3 sigs): {}", e)))?;
    return Ok(serialize_hex(&tx));
}
