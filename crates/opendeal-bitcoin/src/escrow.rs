use bitcoin::hashes::Hash;
use bitcoin::secp256k1::PublicKey;
use bitcoin::{Address, Network, ScriptBuf, WScriptHash};
use serde::{Deserialize, Serialize};

use crate::error::BitcoinError;

/// Three independently controlled compressed pubkeys (buyer, seller, mediator), hex-encoded.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscrowKeys {
    pub buyer_pubkey: String,
    pub seller_pubkey: String,
    pub mediator_pubkey: String,
}

/**
 * Sorted-pubkey 2-of-3 P2WSH escrow. Sorting pubkeys makes the script deterministic regardless
 * of role order at construction time.
 */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscrowDescriptor {
    pub network: String,
    pub witness_script_hex: String,
    pub script_pubkey_hex: String,
    pub address: String,
    pub sorted_pubkeys: Vec<String>,
}

impl EscrowKeys {
    pub fn build_escrow(&self, network: Network) -> Result<EscrowDescriptor, BitcoinError> {
        let mut keys = vec![
            parse_compressed_pubkey(&self.buyer_pubkey)?,
            parse_compressed_pubkey(&self.seller_pubkey)?,
            parse_compressed_pubkey(&self.mediator_pubkey)?,
        ];
        keys.sort_by_key(|a| a.serialize());
        if keys[0] == keys[1] || keys[1] == keys[2] || keys[0] == keys[2] {
            return Err(BitcoinError::InvalidKey(
                "buyer, seller, and mediator pubkeys must be three distinct keys".into(),
            ));
        }

        let witness_script = build_multisig_script(&keys)?;
        let wsh = WScriptHash::hash(witness_script.as_bytes());
        let script_pubkey = ScriptBuf::new_p2wsh(&wsh);
        let address = Address::from_script(&script_pubkey, network)
            .map_err(|e| BitcoinError::Script(e.to_string()))?;

        return Ok(EscrowDescriptor {
            network: network_name(network).to_string(),
            witness_script_hex: hex::encode(witness_script.as_bytes()),
            script_pubkey_hex: hex::encode(script_pubkey.as_bytes()),
            address: address.to_string(),
            sorted_pubkeys: keys.iter().map(|k| hex::encode(k.serialize())).collect(),
        });
    }
}

pub fn parse_network(name: &str) -> Result<Network, BitcoinError> {
    return match name.to_ascii_lowercase().as_str() {
        "regtest" => Ok(Network::Regtest),
        "testnet" | "testnet3" => Ok(Network::Testnet),
        "signet" => Ok(Network::Signet),
        "bitcoin" | "mainnet" => Ok(Network::Bitcoin),
        other => Err(BitcoinError::NetworkMismatch {
            expected: "regtest|testnet|signet|bitcoin".into(),
            got: other.into(),
        }),
    };
}

pub fn network_name(network: Network) -> &'static str {
    return match network {
        Network::Bitcoin => "bitcoin",
        Network::Testnet => "testnet",
        Network::Signet => "signet",
        Network::Regtest => "regtest",
        _ => "unknown",
    };
}

fn parse_compressed_pubkey(hex_key: &str) -> Result<PublicKey, BitcoinError> {
    let raw = if hex_key.len() == 64 {
        let mut v = vec![0x02];
        v.extend(hex::decode(hex_key).map_err(|e| BitcoinError::InvalidKey(e.to_string()))?);
        v
    } else {
        hex::decode(hex_key).map_err(|e| BitcoinError::InvalidKey(e.to_string()))?
    };
    if raw.len() != 33 || (raw[0] != 0x02 && raw[0] != 0x03) {
        return Err(BitcoinError::InvalidKey(
            "expected compressed 33-byte pubkey (or 32-byte x-only mapped to 02||x)".into(),
        ));
    }
    return PublicKey::from_slice(&raw).map_err(|e| BitcoinError::InvalidKey(e.to_string()));
}

fn build_multisig_script(sorted_keys: &[PublicKey]) -> Result<ScriptBuf, BitcoinError> {
    if sorted_keys.len() != 3 {
        return Err(BitcoinError::Script("expected exactly 3 pubkeys".into()));
    }
    // OP_2 <pk1> <pk2> <pk3> OP_3 OP_CHECKMULTISIG
    use bitcoin::blockdata::script::Builder;
    use bitcoin::opcodes::all::{OP_CHECKMULTISIG, OP_PUSHNUM_2, OP_PUSHNUM_3};
    let mut builder = Builder::new().push_opcode(OP_PUSHNUM_2);
    for key in sorted_keys {
        builder = builder.push_slice(key.serialize());
    }
    let script = builder
        .push_opcode(OP_PUSHNUM_3)
        .push_opcode(OP_CHECKMULTISIG)
        .into_script();
    return Ok(script);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_is_deterministic() {
        let secp = bitcoin::secp256k1::Secp256k1::new();
        let sk1 = bitcoin::secp256k1::SecretKey::from_slice(&[1u8; 32]).unwrap();
        let sk2 = bitcoin::secp256k1::SecretKey::from_slice(&[2u8; 32]).unwrap();
        let sk3 = bitcoin::secp256k1::SecretKey::from_slice(&[3u8; 32]).unwrap();
        let keys = EscrowKeys {
            buyer_pubkey: hex::encode(
                bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &sk1).serialize(),
            ),
            seller_pubkey: hex::encode(
                bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &sk2).serialize(),
            ),
            mediator_pubkey: hex::encode(
                bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &sk3).serialize(),
            ),
        };
        let a = keys.build_escrow(Network::Regtest).unwrap();
        let b = keys.build_escrow(Network::Regtest).unwrap();
        assert_eq!(a.address, b.address);
        assert!(a.address.starts_with("bcrt"));
    }

    #[test]
    fn rejects_duplicate_pubkeys() {
        let secp = bitcoin::secp256k1::Secp256k1::new();
        let sk1 = bitcoin::secp256k1::SecretKey::from_slice(&[1u8; 32]).unwrap();
        let sk2 = bitcoin::secp256k1::SecretKey::from_slice(&[2u8; 32]).unwrap();
        let pk1 = hex::encode(
            bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &sk1).serialize(),
        );
        let pk2 = hex::encode(
            bitcoin::secp256k1::PublicKey::from_secret_key(&secp, &sk2).serialize(),
        );
        let keys = EscrowKeys {
            buyer_pubkey: pk1.clone(),
            seller_pubkey: pk2,
            mediator_pubkey: pk1,
        };
        assert!(keys.build_escrow(Network::Regtest).is_err());
    }
}
