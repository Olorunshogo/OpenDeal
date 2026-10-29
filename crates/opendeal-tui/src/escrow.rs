//! Escrow address preview. All derivation is delegated to `opendeal_bitcoin`; this module
//! only normalizes inputs the same way the API does and independently re-checks the result.

use bitcoin::address::NetworkUnchecked;
use bitcoin::blockdata::opcodes::all::{OP_CHECKMULTISIG, OP_PUSHNUM_2, OP_PUSHNUM_3};
use bitcoin::blockdata::script::Instruction;
use bitcoin::{Address, Network, ScriptBuf};
use opendeal_bitcoin::escrow::parse_network;
use opendeal_bitcoin::{EscrowDescriptor, EscrowKeys};
use opendeal_core::verification::normalize_identity;

pub const SCRIPT_TYPE: &str = "p2wsh_multisig_2of3_sorted";

/// Derives the escrow exactly as the API does at `POST /deals/{id}/funding/prepare`:
/// the API stores x-only identities, then calls `EscrowKeys::build_escrow` with them.
pub fn derive_escrow(
    buyer: &str,
    seller: &str,
    mediator: &str,
    network_name: &str,
) -> Result<EscrowDescriptor, String> {
    let network = parse_network(network_name).map_err(|e| e.to_string())?;
    let keys = EscrowKeys {
        buyer_pubkey: normalize_identity(buyer).map_err(|e| format!("buyer: {}", e))?,
        seller_pubkey: normalize_identity(seller).map_err(|e| format!("seller: {}", e))?,
        mediator_pubkey: normalize_identity(mediator).map_err(|e| format!("mediator: {}", e))?,
    };
    let descriptor = keys.build_escrow(network).map_err(|e| e.to_string())?;
    verify_descriptor(&descriptor, network)?;
    return Ok(descriptor);
}

/// Independent consistency check: the address is valid for the network, its scriptPubKey is
/// P2WSH(SHA256(witness script)), and the witness script is exactly
/// `OP_2 <k1> <k2> <k3> OP_3 OP_CHECKMULTISIG` over the sorted keys.
pub fn verify_descriptor(descriptor: &EscrowDescriptor, network: Network) -> Result<(), String> {
    let address = descriptor
        .address
        .parse::<Address<NetworkUnchecked>>()
        .map_err(|_| "escrow address does not parse".to_string())?
        .require_network(network)
        .map_err(|_| "escrow address is not valid for the selected network".to_string())?;
    let spk_hex = hex::encode(address.script_pubkey().as_bytes());
    if spk_hex != descriptor.script_pubkey_hex {
        return Err("escrow address does not match its scriptPubKey".into());
    }
    let witness = ScriptBuf::from_bytes(
        hex::decode(&descriptor.witness_script_hex).map_err(|_| "witness script is not hex")?,
    );
    let expected_spk = ScriptBuf::new_p2wsh(&witness.wscript_hash());
    if hex::encode(expected_spk.as_bytes()) != descriptor.script_pubkey_hex {
        return Err("scriptPubKey is not the P2WSH of the witness script".into());
    }
    let instructions: Vec<Instruction<'_>> = witness
        .instructions()
        .collect::<Result<_, _>>()
        .map_err(|_| "witness script does not decode")?;
    if instructions.len() != 6
        || instructions[0] != Instruction::Op(OP_PUSHNUM_2)
        || instructions[4] != Instruction::Op(OP_PUSHNUM_3)
        || instructions[5] != Instruction::Op(OP_CHECKMULTISIG)
    {
        return Err("witness script is not a 2-of-3 CHECKMULTISIG".into());
    }
    let pushed: Vec<String> = instructions[1..4]
        .iter()
        .map(|i| match i {
            Instruction::PushBytes(bytes) => hex::encode(bytes.as_bytes()),
            _ => String::new(),
        })
        .collect();
    let mut sorted = pushed.clone();
    sorted.sort();
    if pushed != sorted || pushed != descriptor.sorted_pubkeys {
        return Err("witness script keys are not the sorted participant keys".into());
    }
    return Ok(());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::tests::{test_pubkey_compressed, test_pubkey_xonly};

    #[test]
    fn matches_backend_derivation_for_stored_xonly_keys() {
        // The API stores x-only keys, then derives from those. Simulate that path directly.
        let stored = EscrowKeys {
            buyer_pubkey: test_pubkey_xonly(2),
            seller_pubkey: test_pubkey_xonly(1),
            mediator_pubkey: test_pubkey_xonly(3),
        }
        .build_escrow(Network::Regtest)
        .unwrap();
        // The TUI may receive compressed keys (including 03-prefixed); it must normalize first.
        let tui = derive_escrow(
            &test_pubkey_compressed(2),
            &test_pubkey_compressed(1),
            &test_pubkey_compressed(3),
            "regtest",
        )
        .unwrap();
        assert_eq!(tui.address, stored.address);
        assert_eq!(tui.witness_script_hex, stored.witness_script_hex);
        assert!(tui.address.starts_with("bcrt1q"));
    }

    #[test]
    fn known_vector_matches_frontend_test() {
        // Same vector is asserted in frontend/tests/prepared-deal.test.mjs.
        let d = derive_escrow(
            &test_pubkey_xonly(2),
            &test_pubkey_xonly(1),
            &test_pubkey_xonly(3),
            "regtest",
        )
        .unwrap();
        assert_eq!(
            d.address,
            "bcrt1q4vfzl47akjp7trmg06nnqxquu3a07h4dpdzhg9lluxvf8wxqd5xqs6c0c7"
        );
    }

    #[test]
    fn network_changes_address_and_unknown_network_fails() {
        let regtest = derive_escrow(
            &test_pubkey_xonly(2),
            &test_pubkey_xonly(1),
            &test_pubkey_xonly(3),
            "regtest",
        )
        .unwrap();
        let testnet = derive_escrow(
            &test_pubkey_xonly(2),
            &test_pubkey_xonly(1),
            &test_pubkey_xonly(3),
            "testnet",
        )
        .unwrap();
        assert_ne!(regtest.address, testnet.address);
        assert!(testnet.address.starts_with("tb1q"));
        assert!(
            derive_escrow(
                &test_pubkey_xonly(2),
                &test_pubkey_xonly(1),
                &test_pubkey_xonly(3),
                "moonnet"
            )
            .is_err()
        );
    }

    #[test]
    fn verification_detects_tampering() {
        let mut d = derive_escrow(
            &test_pubkey_xonly(2),
            &test_pubkey_xonly(1),
            &test_pubkey_xonly(3),
            "regtest",
        )
        .unwrap();
        assert!(verify_descriptor(&d, Network::Regtest).is_ok());
        assert!(verify_descriptor(&d, Network::Testnet).is_err());
        let other = derive_escrow(
            &test_pubkey_xonly(4),
            &test_pubkey_xonly(1),
            &test_pubkey_xonly(3),
            "regtest",
        )
        .unwrap();
        d.address = other.address;
        assert!(verify_descriptor(&d, Network::Regtest).is_err());
    }

    #[test]
    fn duplicate_keys_are_rejected_by_shared_implementation() {
        assert!(
            derive_escrow(
                &test_pubkey_xonly(1),
                &test_pubkey_compressed(1),
                &test_pubkey_xonly(3),
                "regtest"
            )
            .is_err()
        );
    }
}
