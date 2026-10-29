//! Public participant identities. The TUI only ever handles public keys.
//!
//! Formats match the backend exactly:
//! - **Identity** (what the API stores, signs in with, and compares): 32-byte x-only hex,
//!   produced by `opendeal_core::verification::normalize_identity`.
//! - **Escrow script key**: the 33-byte compressed key `02 || x` that
//!   `opendeal_bitcoin::EscrowKeys::build_escrow` puts in the 2-of-3 witness script.

use opendeal_core::verification::normalize_identity;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Seller,
    Buyer,
    Mediator,
}

impl Role {
    pub const ALL: [Role; 3] = [Role::Seller, Role::Buyer, Role::Mediator];

    pub fn as_str(self) -> &'static str {
        return match self {
            Role::Seller => "seller",
            Role::Buyer => "buyer",
            Role::Mediator => "mediator",
        };
    }

    pub fn title(self) -> &'static str {
        return match self {
            Role::Seller => "Seller",
            Role::Buyer => "Buyer",
            Role::Mediator => "Mediator",
        };
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdentitySource {
    /// Public key read from the browser's encrypted recovery file (never decrypted).
    RecoveryFile,
    /// Public key typed or pasted into the TUI.
    Manual,
    /// Approved mediator returned by `GET /api/v1/mediators`.
    Registry {
        display_name: String,
        origin: String,
    },
    /// Loaded from a previously exported prepared-deal file.
    PreparedConfig,
}

impl IdentitySource {
    pub fn describe(&self) -> String {
        return match self {
            IdentitySource::RecoveryFile => "browser recovery file (public key only)".into(),
            IdentitySource::Manual => "entered manually".into(),
            IdentitySource::Registry {
                display_name,
                origin,
            } => format!("mediator registry: {} ({})", display_name, origin),
            IdentitySource::PreparedConfig => "prepared configuration file".into(),
        };
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicIdentity {
    pub role: Role,
    /// Normalized 32-byte x-only hex identity.
    pub xonly: String,
    pub source: IdentitySource,
}

impl PublicIdentity {
    pub fn new(role: Role, raw: &str, source: IdentitySource) -> Result<Self, String> {
        let xonly = parse_public_key(raw)?;
        return Ok(PublicIdentity {
            role,
            xonly,
            source,
        });
    }

    /// Compressed key as it appears in the escrow witness script.
    pub fn escrow_key(&self) -> String {
        return format!("02{}", self.xonly);
    }

    pub fn short(&self) -> String {
        return short_key(&self.xonly);
    }
}

pub fn short_key(key: &str) -> String {
    if key.len() <= 20 {
        return key.to_string();
    }
    return format!("{}…{}", &key[..10], &key[key.len() - 6..]);
}

/// Validates a pasted public key and returns the normalized x-only identity.
///
/// Error messages never echo the input, so a mistakenly pasted secret is not shown back.
pub fn parse_public_key(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Public key is empty.".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("nsec") || lower.starts_with("xprv") || lower.starts_with("tprv") {
        return Err(
            "That looks like a PRIVATE key. It was discarded. Paste only public keys here.".into(),
        );
    }
    if lower.starts_with("npub") {
        return Err(
            "npub (bech32) keys are not accepted. Paste the 64-character hex public key.".into(),
        );
    }
    if lower.starts_with("0x") {
        return Err("Remove the 0x prefix; paste plain hex.".into());
    }
    if !lower.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Public key must be hex (0-9, a-f).".into());
    }
    return match lower.len() {
        64 | 66 => {
            normalize_identity(&lower).map_err(|_| "Not a valid secp256k1 public key.".to_string())
        }
        130 => Err(
            "Uncompressed keys are not supported. Use a 32-byte x-only or 33-byte compressed key."
                .into(),
        ),
        n => Err(format!(
            "Expected 64 hex characters (x-only) or 66 (compressed 02/03), got {}.",
            n
        )),
    };
}

/// Buyer, seller and mediator must be three different people (the backend rejects duplicates).
pub fn check_distinct(identities: &[&PublicIdentity]) -> Result<(), String> {
    for (i, a) in identities.iter().enumerate() {
        for b in identities.iter().skip(i + 1) {
            if a.xonly == b.xonly {
                return Err(format!(
                    "{} and {} use the same public key; all three participants must be distinct.",
                    a.role.title(),
                    b.role.title()
                ));
            }
        }
    }
    return Ok(());
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use bitcoin::secp256k1::{PublicKey, Secp256k1, SecretKey};

    /// Deterministic test key (never used outside tests).
    pub fn test_pubkey_compressed(seed: u8) -> String {
        let secp = Secp256k1::new();
        let secret = SecretKey::from_slice(&[seed; 32]).unwrap();
        return hex::encode(PublicKey::from_secret_key(&secp, &secret).serialize());
    }

    pub fn test_pubkey_xonly(seed: u8) -> String {
        return test_pubkey_compressed(seed)[2..].to_string();
    }

    #[test]
    fn accepts_xonly_and_compressed_and_normalizes_to_xonly() {
        let compressed = test_pubkey_compressed(1);
        let xonly = test_pubkey_xonly(1);
        assert_eq!(parse_public_key(&compressed).unwrap(), xonly);
        assert_eq!(parse_public_key(&xonly).unwrap(), xonly);
        assert_eq!(
            parse_public_key(&format!("  {}\n", compressed.to_uppercase())).unwrap(),
            xonly
        );
    }

    #[test]
    fn rejects_bad_lengths_encodings_and_curve_points() {
        assert!(parse_public_key("").is_err());
        assert!(parse_public_key("abc").is_err());
        assert!(parse_public_key(&"zz".repeat(32)).is_err());
        assert!(parse_public_key(&format!("0x{}", test_pubkey_xonly(1))).is_err());
        // 04-prefixed / wrong prefix 33-byte key
        assert!(parse_public_key(&format!("04{}", test_pubkey_xonly(1))).is_err());
        // Uncompressed length
        assert!(parse_public_key(&"04".repeat(65)).is_err());
        // x = 0 is not on the curve
        assert!(parse_public_key(&"00".repeat(32)).is_err());
        assert!(parse_public_key("npub1qqqq").is_err());
    }

    #[test]
    fn private_key_errors_do_not_echo_input() {
        let fake_secret = "nsec1verysecretvalue";
        let err = parse_public_key(fake_secret).unwrap_err();
        assert!(err.contains("PRIVATE"));
        assert!(!err.contains("verysecretvalue"));
        let bad_hex = format!("{}g", "a".repeat(63));
        assert!(!parse_public_key(&bad_hex).unwrap_err().contains(&bad_hex));
    }

    #[test]
    fn escrow_key_is_02_prefixed_xonly() {
        let id = PublicIdentity::new(
            Role::Buyer,
            &test_pubkey_compressed(2),
            IdentitySource::Manual,
        )
        .unwrap();
        assert_eq!(id.escrow_key(), format!("02{}", test_pubkey_xonly(2)));
        assert_eq!(id.escrow_key().len(), 66);
    }

    #[test]
    fn duplicate_participants_are_rejected() {
        let a = PublicIdentity::new(Role::Seller, &test_pubkey_xonly(1), IdentitySource::Manual)
            .unwrap();
        let b = PublicIdentity::new(
            Role::Buyer,
            &test_pubkey_compressed(1),
            IdentitySource::Manual,
        )
        .unwrap();
        let c = PublicIdentity::new(
            Role::Mediator,
            &test_pubkey_xonly(3),
            IdentitySource::Manual,
        )
        .unwrap();
        assert!(check_distinct(&[&a, &b, &c]).is_err());
        let b2 = PublicIdentity::new(Role::Buyer, &test_pubkey_xonly(2), IdentitySource::Manual)
            .unwrap();
        assert!(check_distinct(&[&a, &b2, &c]).is_ok());
    }
}
