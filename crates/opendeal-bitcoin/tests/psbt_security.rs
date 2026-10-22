use bitcoin::hashes::Hash;
use bitcoin::secp256k1::{Message, PublicKey, Secp256k1, SecretKey};
use bitcoin::sighash::{EcdsaSighashType, SighashCache};
use bitcoin::{Amount, Network, Witness};
use opendeal_bitcoin::psbt::{
    build_settlement_psbt, extract_tx_hex, finalize_validated, psbt_from_base64, psbt_to_base64,
    validate_partial_signatures, validated_combine,
};
use opendeal_bitcoin::{EscrowKeys, SettlementPurpose};

fn fixture() -> (String, [SecretKey; 3]) {
    let secp = Secp256k1::new();
    let secrets = [1, 2, 3].map(|v| SecretKey::from_slice(&[v; 32]).unwrap());
    let public = secrets.map(|key| PublicKey::from_secret_key(&secp, &key).to_string());
    let escrow = EscrowKeys {
        buyer_pubkey: public[0].clone(),
        seller_pubkey: public[1].clone(),
        mediator_pubkey: public[2].clone(),
    }
    .build_escrow(Network::Regtest)
    .unwrap();
    let proposal = build_settlement_psbt(
        &escrow,
        &"ab".repeat(32),
        3,
        100_000,
        &escrow.address,
        1000,
        SettlementPurpose::PayoutSeller,
    )
    .unwrap();
    (proposal.psbt_base64, secrets)
}
fn sign(base: &str, secret: &SecretKey) -> String {
    let mut psbt = psbt_from_base64(base).unwrap();
    let input = &psbt.inputs[0];
    let hash = SighashCache::new(&psbt.unsigned_tx)
        .p2wsh_signature_hash(
            0,
            input.witness_script.as_ref().unwrap(),
            input.witness_utxo.as_ref().unwrap().value,
            EcdsaSighashType::All,
        )
        .unwrap();
    let secp = Secp256k1::new();
    let signature = secp.sign_ecdsa(&Message::from_digest(hash.to_byte_array()), secret);
    psbt.inputs[0].partial_sigs.insert(
        bitcoin::PublicKey::new(PublicKey::from_secret_key(&secp, secret)),
        bitcoin::ecdsa::Signature {
            signature,
            sighash_type: EcdsaSighashType::All,
        },
    );
    psbt_to_base64(&psbt).unwrap()
}
#[test]
fn validated_external_signatures_finalize_a_sorted_multisig_witness() {
    let (base, secrets) = fixture();
    assert!(finalize_validated(&base).is_err());
    let first = validated_combine(&base, &sign(&base, &secrets[0])).unwrap();
    assert_eq!(
        validate_partial_signatures(&psbt_from_base64(&first).unwrap()).unwrap(),
        1
    );
    assert!(finalize_validated(&first).is_err());
    let both = validated_combine(&first, &sign(&base, &secrets[1])).unwrap();
    let finalized = finalize_validated(&both).unwrap();
    let tx: bitcoin::Transaction =
        bitcoin::consensus::encode::deserialize_hex(&extract_tx_hex(&finalized).unwrap()).unwrap();
    assert_eq!(tx.input[0].previous_output.vout, 3);
    assert_eq!(tx.output[0].value.to_sat(), 99_000);
    let stack: Vec<_> = tx.input[0].witness.iter().collect();
    assert_eq!(stack.len(), 4);
    assert!(stack[0].is_empty());
    let script = bitcoin::ScriptBuf::from_bytes(stack[3].to_vec());
    let hash = SighashCache::new(&tx)
        .p2wsh_signature_hash(0, &script, Amount::from_sat(100_000), EcdsaSighashType::All)
        .unwrap();
    let message = Message::from_digest(hash.to_byte_array());
    let secp = Secp256k1::new();
    let mut keys =
        [secrets[0], secrets[1]].map(|secret| PublicKey::from_secret_key(&secp, &secret));
    keys.sort_by_key(PublicKey::serialize);
    for (raw, key) in stack[1..3].iter().zip(keys) {
        let sig = bitcoin::ecdsa::Signature::from_slice(raw).unwrap();
        secp.verify_ecdsa(&message, &sig.signature, &key).unwrap();
    }
}
#[test]
fn unsigned_transaction_outpoint_and_metadata_tampering_are_rejected() {
    let (base, secrets) = fixture();
    let signed = psbt_from_base64(&sign(&base, &secrets[0])).unwrap();
    for case in 0..5 {
        let mut altered = signed.clone();
        match case {
            0 => altered.unsigned_tx.input[0].previous_output.vout += 1,
            1 => altered.unsigned_tx.output[0].value = Amount::from_sat(98_000),
            2 => altered.inputs[0].witness_utxo.as_mut().unwrap().value = Amount::from_sat(200_000),
            3 => altered.inputs[0].final_script_witness = Some(Witness::new()),
            _ => altered.inputs[0].sighash_type = Some(EcdsaSighashType::None.into()),
        }
        assert!(
            validated_combine(&base, &psbt_to_base64(&altered).unwrap()).is_err(),
            "case {case}"
        );
    }
}
#[test]
fn invalid_signatures_and_nonparticipant_signers_are_rejected() {
    let (base, secrets) = fixture();
    let outsider = SecretKey::from_slice(&[4; 32]).unwrap();
    assert!(validated_combine(&base, &sign(&base, &outsider)).is_err());
    let mut invalid = psbt_from_base64(&sign(&base, &secrets[0])).unwrap();
    let secp = Secp256k1::new();
    invalid.inputs[0]
        .partial_sigs
        .values_mut()
        .next()
        .unwrap()
        .signature = secp.sign_ecdsa(&Message::from_digest([7; 32]), &secrets[0]);
    assert!(validated_combine(&base, &psbt_to_base64(&invalid).unwrap()).is_err());
}
