//! Reads **public** data from browser recovery files:
//! - single-identity files from `/onboarding` (`kind: "opendeal.identity"`), and
//! - earlier three-participant workspace files (`participants.{seller,buyer,mediator}`).
//!
//! The encrypted envelopes (`salt`, `iv`, `ciphertext`) are never deserialized, decrypted,
//! stored, or re-exported. No passphrase is ever requested.

use serde::Deserialize;

use crate::identity::parse_public_key;

/// Same limit the frontend applies to recovery files.
pub const MAX_RECOVERY_BYTES: usize = 64_000;

#[derive(Deserialize)]
struct RawWorkspace {
    version: u32,
    participants: RawParticipants,
    #[serde(rename = "dealId", default)]
    deal_id: Option<String>,
    #[serde(default)]
    payout: Option<String>,
    #[serde(default)]
    refund: Option<String>,
}

#[derive(Deserialize)]
struct RawParticipants {
    seller: RawIdentity,
    buyer: RawIdentity,
    mediator: RawIdentity,
}

/// Only public fields are declared, so encrypted envelopes are skipped by serde.
#[derive(Deserialize)]
struct RawIdentity {
    version: u32,
    role: String,
    pubkey: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryPublicData {
    pub seller: String,
    pub buyer: String,
    pub mediator: String,
    pub deal_id: Option<String>,
    /// Unvalidated here; validated against the API network when used as deal terms.
    pub payout: Option<String>,
    pub refund: Option<String>,
}

pub fn parse_recovery_public_data(text: &str) -> Result<RecoveryPublicData, String> {
    if text.len() > MAX_RECOVERY_BYTES {
        return Err("Recovery file is too large.".into());
    }
    let raw: RawWorkspace = serde_json::from_str(text)
        .map_err(|_| "Not an OpenDeal demo recovery file (unexpected JSON shape).".to_string())?;
    if raw.version != 1 {
        return Err(format!(
            "Unsupported recovery file version {}.",
            raw.version
        ));
    }
    let mut keys = Vec::with_capacity(3);
    for (expected, identity) in [
        ("seller", &raw.participants.seller),
        ("buyer", &raw.participants.buyer),
        ("mediator", &raw.participants.mediator),
    ] {
        if identity.version != 1 || identity.role != expected {
            return Err(format!("Recovery file {} entry is malformed.", expected));
        }
        let is_lower_hex = identity.pubkey.len() == 64
            && identity
                .pubkey
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c));
        if !is_lower_hex {
            return Err(format!(
                "Recovery file {} public key is malformed.",
                expected
            ));
        }
        let normalized = parse_public_key(&identity.pubkey)
            .map_err(|e| format!("Recovery file {} public key: {}", expected, e))?;
        keys.push(normalized);
    }
    if keys[0] == keys[1] || keys[0] == keys[2] || keys[1] == keys[2] {
        return Err("Recovery file participants must be distinct.".into());
    }
    let deal_id = match raw.deal_id {
        Some(id) => Some(parse_deal_id(&id)?),
        None => None,
    };
    return Ok(RecoveryPublicData {
        seller: keys[0].clone(),
        buyer: keys[1].clone(),
        mediator: keys[2].clone(),
        deal_id,
        payout: raw.payout.filter(|v| !v.trim().is_empty()),
        refund: raw.refund.filter(|v| !v.trim().is_empty()),
    });
}

pub const IDENTITY_FILE_KIND: &str = "opendeal.identity";

#[derive(Deserialize)]
struct RawIdentityFile {
    version: u32,
    kind: String,
    identity: RawPublicKeyOnly,
}

/// Only the public key is declared; the encrypted envelope is skipped.
#[derive(Deserialize)]
struct RawPublicKeyOnly {
    pubkey: String,
}

/// True when the JSON looks like a single-identity file from `/onboarding`.
pub fn is_identity_file(value: &serde_json::Value) -> bool {
    return value.get("kind").and_then(|k| k.as_str()) == Some(IDENTITY_FILE_KIND);
}

/// Returns the x-only public key of a single-identity recovery file.
pub fn parse_identity_file(text: &str) -> Result<String, String> {
    if text.len() > MAX_RECOVERY_BYTES {
        return Err("Recovery file is too large.".into());
    }
    let raw: RawIdentityFile = serde_json::from_str(text)
        .map_err(|_| "Not an OpenDeal identity file (unexpected JSON shape).".to_string())?;
    if raw.version != 1 || raw.kind != IDENTITY_FILE_KIND {
        return Err("Unsupported identity file version.".into());
    }
    let key = &raw.identity.pubkey;
    let is_lower_hex = key.len() == 64
        && key
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c));
    if !is_lower_hex {
        return Err("Identity file public key is malformed.".into());
    }
    return parse_public_key(key).map_err(|e| format!("Identity file public key: {}", e));
}

/// Deal IDs are the hex SHA-256 of the canonical agreement.
pub fn parse_deal_id(raw: &str) -> Result<String, String> {
    let id = raw.trim().to_ascii_lowercase();
    if id.len() != 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Deal ID must be 64 hex characters.".into());
    }
    return Ok(id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::tests::test_pubkey_xonly;

    fn sample(seller: &str, buyer: &str, mediator: &str) -> serde_json::Value {
        let envelope = |role: &str, pubkey: &str| {
            serde_json::json!({
                "version": 1, "role": role, "pubkey": pubkey,
                "salt": "AAAAAAAAAAAAAAAAAAAAAA==", "iv": "AAAAAAAAAAAAAAAA",
                "ciphertext": "SECRET-CIPHERTEXT-MARKER"
            })
        };
        return serde_json::json!({
            "version": 1,
            "createdAt": "2026-10-28T10:00:00.000Z",
            "participants": {
                "seller": envelope("seller", seller),
                "buyer": envelope("buyer", buyer),
                "mediator": envelope("mediator", mediator),
            },
            "payout": "bcrt1qexamplepayout",
            "dealId": "AB".repeat(32),
        });
    }

    #[test]
    fn reads_public_keys_and_ignores_encrypted_envelopes() {
        let text = sample(
            &test_pubkey_xonly(1),
            &test_pubkey_xonly(2),
            &test_pubkey_xonly(3),
        )
        .to_string();
        let data = parse_recovery_public_data(&text).unwrap();
        assert_eq!(data.seller, test_pubkey_xonly(1));
        assert_eq!(data.buyer, test_pubkey_xonly(2));
        assert_eq!(data.mediator, test_pubkey_xonly(3));
        assert_eq!(data.deal_id.as_deref(), Some("ab".repeat(32).as_str()));
        assert!(!format!("{:?}", data).contains("SECRET-CIPHERTEXT-MARKER"));
    }

    #[test]
    fn rejects_malformed_files() {
        let k = |n| test_pubkey_xonly(n);
        assert!(parse_recovery_public_data("not json").is_err());
        assert!(parse_recovery_public_data(&"x".repeat(MAX_RECOVERY_BYTES + 1)).is_err());
        assert!(parse_recovery_public_data(&sample(&k(1), &k(1), &k(3)).to_string()).is_err());
        let mut wrong_version = sample(&k(1), &k(2), &k(3));
        wrong_version["version"] = serde_json::json!(2);
        assert!(parse_recovery_public_data(&wrong_version.to_string()).is_err());
        let mut swapped = sample(&k(1), &k(2), &k(3));
        swapped["participants"]["buyer"]["role"] = serde_json::json!("seller");
        assert!(parse_recovery_public_data(&swapped.to_string()).is_err());
        let mut bad_deal = sample(&k(1), &k(2), &k(3));
        bad_deal["dealId"] = serde_json::json!("nope");
        assert!(parse_recovery_public_data(&bad_deal.to_string()).is_err());
        let upper = sample(&k(1).to_uppercase(), &k(2), &k(3));
        assert!(parse_recovery_public_data(&upper.to_string()).is_err());
    }

    #[test]
    fn reads_single_identity_files_without_the_envelope() {
        let file = serde_json::json!({
            "version": 1, "kind": "opendeal.identity", "createdAt": "2026-10-29T00:00:00Z",
            "identity": {"pubkey": test_pubkey_xonly(4), "salt": "x", "iv": "y", "ciphertext": "SECRET-MARKER"}
        });
        assert!(is_identity_file(&file));
        assert_eq!(
            parse_identity_file(&file.to_string()).unwrap(),
            test_pubkey_xonly(4)
        );
        let mut bad = file.clone();
        bad["identity"]["pubkey"] = serde_json::json!("00".repeat(32));
        assert!(parse_identity_file(&bad.to_string()).is_err());
        let mut wrong = file.clone();
        wrong["version"] = serde_json::json!(2);
        assert!(parse_identity_file(&wrong.to_string()).is_err());
        assert!(!is_identity_file(
            &serde_json::json!({"version": 1, "participants": {}})
        ));
    }

    #[test]
    fn deal_id_validation() {
        assert!(parse_deal_id(&"a".repeat(64)).is_ok());
        assert!(parse_deal_id(&"a".repeat(63)).is_err());
        assert!(parse_deal_id(&"g".repeat(64)).is_err());
    }
}
