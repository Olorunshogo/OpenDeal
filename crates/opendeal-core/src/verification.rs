use secp256k1::ecdsa::Signature as SecpSignature;
use secp256k1::{Message, PublicKey, Secp256k1, SecretKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::agreement::Agreement;
use crate::error::ProtocolError;
use crate::event::DealEvent;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signature {
    /// Compact hex-encoded secp256k1 ECDSA signature.
    pub sig: String,
    /// 33-byte compressed pubkey hex that produced `sig`.
    pub pubkey: String,
}

pub fn hash_message(bytes: &[u8]) -> Message {
    let digest = Sha256::digest(bytes);
    return Message::from_digest_slice(&digest).expect("SHA-256 digest is 32 bytes");
}

pub fn sign_bytes(secret_key: &SecretKey, bytes: &[u8]) -> Signature {
    let secp = Secp256k1::new();
    let msg = hash_message(bytes);
    let sig = secp.sign_ecdsa(&msg, secret_key);
    let pubkey = PublicKey::from_secret_key(&secp, secret_key);
    return Signature {
        sig: hex::encode(sig.serialize_compact()),
        pubkey: hex::encode(pubkey.serialize()),
    };
}

pub fn verify_signature(bytes: &[u8], signature: &Signature) -> Result<(), ProtocolError> {
    let secp = Secp256k1::verification_only();
    let msg = hash_message(bytes);
    let pk_bytes = hex::decode(&signature.pubkey)
        .map_err(|e| ProtocolError::InvalidSignature(format!("pubkey hex: {}", e)))?;
    let pubkey = PublicKey::from_slice(&pk_bytes)
        .map_err(|e| ProtocolError::InvalidSignature(format!("pubkey: {}", e)))?;
    let sig_bytes = hex::decode(&signature.sig)
        .map_err(|e| ProtocolError::InvalidSignature(format!("sig hex: {}", e)))?;
    let sig = SecpSignature::from_compact(&sig_bytes)
        .map_err(|e| ProtocolError::InvalidSignature(format!("sig: {}", e)))?;
    secp.verify_ecdsa(&msg, &sig, &pubkey)
        .map_err(|e| ProtocolError::InvalidSignature(format!("verify failed: {}", e)))?;
    return Ok(());
}

/// Parties sign the canonical agreement bytes; `pubkey` must match a party on the agreement.
pub fn verify_agreement_signature(
    agreement: &Agreement,
    signature: &Signature,
) -> Result<(), ProtocolError> {
    let bytes = agreement.canonical_bytes()?;
    verify_signature(&bytes, signature)?;

    let xonly_or_hex = agreement_party_keys(agreement);
    let compressed = &signature.pubkey;
    let matches = xonly_or_hex.iter().any(|k| {
        k.eq_ignore_ascii_case(compressed)
            || compressed.len() == 66 && k.eq_ignore_ascii_case(&compressed[2..])
    });
    if !matches {
        return Err(ProtocolError::Unauthorized(
            "signature pubkey is not a party on this agreement".into(),
        ));
    }
    return Ok(());
}

fn agreement_party_keys(agreement: &Agreement) -> [String; 3] {
    return [
        agreement.seller_pubkey.clone(),
        agreement.buyer_pubkey.clone(),
        agreement.mediator_pubkey.clone(),
    ];
}

/**
 * Verifies hash linkage and optional signatures across an ordered event list.
 * Genesis must have empty `prev_event_hash` and `sequence == 0`.
 */
pub fn verify_event_chain(events: &[DealEvent]) -> Result<(), ProtocolError> {
    if events.is_empty() {
        return Ok(());
    }

    let mut expected_prev = String::new();
    for (idx, event) in events.iter().enumerate() {
        let kind = serde_json::to_value(&event.kind)
            .map_err(|e| ProtocolError::Canonicalization(e.to_string()))?;
        let payload = serde_json::to_value(&event.payload)
            .map_err(|e| ProtocolError::Canonicalization(e.to_string()))?;
        if payload.get("type") != Some(&kind) {
            return Err(ProtocolError::BrokenChain(
                "event kind/payload mismatch".into(),
            ));
        }
        if event.sequence != idx as u64 {
            return Err(ProtocolError::BrokenChain(format!(
                "expected sequence {}, got {}",
                idx, event.sequence
            )));
        }
        if event.prev_event_hash != expected_prev {
            return Err(ProtocolError::BrokenChain(format!(
                "sequence {}: prev hash mismatch",
                idx
            )));
        }
        if let Some(sig) = &event.signature {
            let bytes = event.signing_bytes()?;
            verify_signature(&bytes, sig)?;
            if !sig.pubkey.eq_ignore_ascii_case(&event.actor_pubkey)
                && !(sig.pubkey.len() == 66
                    && event.actor_pubkey.eq_ignore_ascii_case(&sig.pubkey[2..]))
            {
                return Err(ProtocolError::BrokenChain(format!(
                    "sequence {}: actor_pubkey does not match signature pubkey",
                    idx
                )));
            }
        }
        expected_prev = event.event_hash()?;
    }
    return Ok(());
}

/// Canonical identity shared by Nostr authentication and agreement participants.
pub fn normalize_identity(raw: &str) -> Result<String, ProtocolError> {
    if raw.len() != 64 && raw.len() != 66 {
        return Err(ProtocolError::InvalidAgreement(
            "expected x-only or compressed public key".into(),
        ));
    }
    let full = if raw.len() == 64 {
        format!("02{}", raw)
    } else {
        raw.to_owned()
    };
    let bytes = hex::decode(full)
        .map_err(|_| ProtocolError::InvalidAgreement("invalid public key".into()))?;
    let key = PublicKey::from_slice(&bytes)
        .map_err(|_| ProtocolError::InvalidAgreement("invalid secp256k1 public key".into()))?;
    Ok(key.x_only_public_key().0.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agreement::Agreement;
    use crate::event::{EventKind, EventPayload};
    use crate::settlement::SettlementModel;
    use chrono::{TimeZone, Utc};
    use secp256k1::rand::rngs::OsRng;

    fn keypair() -> (SecretKey, String, String) {
        let secp = Secp256k1::new();
        let (sk, pk) = secp.generate_keypair(&mut OsRng);
        let compressed = hex::encode(pk.serialize());
        let xonly = compressed[2..].to_string();
        return (sk, compressed, xonly);
    }

    #[test]
    fn round_trip_sign_verify() {
        let (sk, _, _) = keypair();
        let bytes = b"hello opendeal";
        let sig = sign_bytes(&sk, bytes);
        assert!(verify_signature(bytes, &sig).is_ok());
    }

    #[test]
    fn agreement_signature_binds_party() {
        let (sk_seller, compressed, xonly) = keypair();
        let (_, _, buyer) = keypair();
        let (_, _, mediator) = keypair();
        let agreement = Agreement {
            version: 1,
            description: None,
            seller_payout_address: None,
            buyer_refund_address: None,
            title: "Laptop".into(),
            amount_sats: 10_000,
            currency: "BTC".into(),
            seller_pubkey: xonly,
            buyer_pubkey: buyer,
            mediator_pubkey: mediator,
            delivery_deadline: Utc.with_ymd_and_hms(2026, 12, 1, 0, 0, 0).unwrap(),
            acceptance_window_hours: 24,
            settlement_model: SettlementModel::BitcoinMultisig2of3,
            network: "regtest".into(),
            created_at: Utc.with_ymd_and_hms(2026, 10, 14, 0, 0, 0).unwrap(),
        };
        let bytes = agreement.canonical_bytes().unwrap();
        let mut sig = sign_bytes(&sk_seller, &bytes);
        // sign_bytes embeds compressed pubkey; agreement stores x-only. verify_agreement_signature accepts both.
        assert_eq!(sig.pubkey, compressed);
        assert!(verify_agreement_signature(&agreement, &sig).is_ok());

        let (sk_stranger, _, _) = keypair();
        sig = sign_bytes(&sk_stranger, &bytes);
        assert!(verify_agreement_signature(&agreement, &sig).is_err());
    }

    #[test]
    fn event_chain_detects_tamper() {
        let agreement_id = "ab".repeat(32);
        let t0 = Utc.with_ymd_and_hms(2026, 10, 14, 0, 0, 0).unwrap();
        let e0 = DealEvent::unsigned(
            agreement_id.clone(),
            0,
            EventKind::DealCreated,
            EventPayload::DealCreated {
                agreement_id: agreement_id.clone(),
            },
            "aa".repeat(32),
            String::new(),
            t0,
        );
        let h0 = e0.event_hash().unwrap();
        let e1 = DealEvent::unsigned(
            agreement_id,
            1,
            EventKind::StatusTransitioned,
            EventPayload::StatusTransitioned {
                from: crate::DealStatus::Draft,
                to: crate::DealStatus::Agreed,
            },
            "aa".repeat(32),
            h0,
            t0,
        );
        assert!(verify_event_chain(&[e0.clone(), e1.clone()]).is_ok());

        let mut broken = e1;
        broken.prev_event_hash = "00".repeat(32);
        assert!(verify_event_chain(&[e0, broken]).is_err());
    }
}
