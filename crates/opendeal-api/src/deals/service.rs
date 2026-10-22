use chrono::Utc;
use opendeal_bitcoin::psbt::{
    build_settlement_psbt, extract_tx_hex, finalize_validated, psbt_from_base64,
    validate_partial_signatures, validated_combine,
};
use opendeal_bitcoin::{EscrowDescriptor, EscrowKeys, SettlementPurpose};
use opendeal_core::verification::normalize_identity;
use opendeal_core::{
    Agreement, DealReceipt, DealStatus, EventKind, EventPayload, Signature,
    verify_agreement_signature,
};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool, Postgres, Transaction};

use super::events::append_event_conn;
use super::models::{CreateDealRequest, Deal, parse_settlement_model};
use crate::error::ApiError;
use crate::state::AppState;

pub fn is_buyer(deal: &Deal, actor: &str) -> bool {
    normalize_identity(&deal.buyer_pubkey).ok().as_deref() == Some(actor)
}
pub fn is_seller(deal: &Deal, actor: &str) -> bool {
    normalize_identity(&deal.seller_pubkey).ok().as_deref() == Some(actor)
}
pub fn is_mediator(deal: &Deal, actor: &str) -> bool {
    normalize_identity(&deal.mediator_pubkey).ok().as_deref() == Some(actor)
}

pub fn assert_party(deal: &Deal, actor: &str) -> Result<(), ApiError> {
    if is_buyer(deal, actor) || is_seller(deal, actor) || is_mediator(deal, actor) {
        Ok(())
    } else {
        Err(ApiError::forbidden("not a party to this deal"))
    }
}

pub async fn get_deal(pool: &PgPool, id: &str) -> Result<Deal, ApiError> {
    sqlx::query_as("SELECT * FROM deals WHERE id=$1")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::not_found("deal not found"))
}

pub async fn locked<'a>(
    state: &'a AppState,
    id: &str,
    actor: &str,
) -> Result<(Transaction<'a, Postgres>, Deal), ApiError> {
    let mut tx = state.pool.begin().await?;
    let deal = sqlx::query_as("SELECT * FROM deals WHERE id=$1 FOR UPDATE")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::not_found("deal not found"))?;
    assert_party(&deal, actor)?;
    Ok((tx, deal))
}

pub async fn finish(mut tx: Transaction<'_, Postgres>, id: &str) -> Result<Deal, ApiError> {
    let deal = sqlx::query_as("SELECT * FROM deals WHERE id=$1")
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(deal)
}

pub fn agreement(deal: &Deal) -> Result<Agreement, ApiError> {
    let terms: Agreement = serde_json::from_value(deal.agreement_json.clone())
        .map_err(|_| ApiError::Internal("invalid stored agreement".into()))?;
    if terms.agreement_id().map_err(ApiError::from)? != deal.id
        || normalize_identity(&terms.buyer_pubkey).map_err(ApiError::from)?
            != normalize_identity(&deal.buyer_pubkey).map_err(ApiError::from)?
        || normalize_identity(&terms.seller_pubkey).map_err(ApiError::from)?
            != normalize_identity(&deal.seller_pubkey).map_err(ApiError::from)?
        || normalize_identity(&terms.mediator_pubkey).map_err(ApiError::from)?
            != normalize_identity(&deal.mediator_pubkey).map_err(ApiError::from)?
        || terms.amount_sats != u64::try_from(deal.amount_sats).unwrap_or(0)
        || terms.network != deal.network
        || terms.settlement_model.as_str() != deal.settlement_model
        || terms.currency != deal.currency
        || terms.title != deal.title
    {
        return Err(ApiError::Internal(
            "stored deal contradicts its canonical agreement".into(),
        ));
    }
    Ok(terms)
}

async fn has_agreement_consent(
    connection: &mut PgConnection,
    deal: &Deal,
) -> Result<bool, ApiError> {
    let terms = agreement(deal)?;
    let rows: Vec<(serde_json::Value,)> =
        sqlx::query_as("SELECT signature_json FROM agreement_signatures WHERE agreement_id=$1")
            .bind(&deal.id)
            .fetch_all(connection)
            .await?;
    let mut signers = std::collections::HashSet::new();
    for (value,) in rows {
        let signature: Signature = serde_json::from_value(value)
            .map_err(|_| ApiError::Internal("invalid stored signature".into()))?;
        verify_agreement_signature(&terms, &signature).map_err(ApiError::from)?;
        signers.insert(normalize_identity(&signature.pubkey).map_err(ApiError::from)?);
    }
    Ok(
        signers.contains(&normalize_identity(&terms.buyer_pubkey).map_err(ApiError::from)?)
            && signers.contains(&normalize_identity(&terms.seller_pubkey).map_err(ApiError::from)?),
    )
}

pub async fn set_status(
    connection: &mut PgConnection,
    deal: &Deal,
    to: DealStatus,
    actor: &str,
) -> Result<(), ApiError> {
    let from = deal.status_enum().map_err(ApiError::bad_request)?;
    from.transition_to(to).map_err(ApiError::from)?;
    sqlx::query("UPDATE deals SET status=$2, updated_at=now() WHERE id=$1")
        .bind(&deal.id)
        .bind(to.as_str())
        .execute(&mut *connection)
        .await?;
    append_event_conn(
        connection,
        &deal.id,
        EventKind::StatusTransitioned,
        EventPayload::StatusTransitioned { from, to },
        actor,
        None,
    )
    .await?;
    let updated: Deal = sqlx::query_as("SELECT * FROM deals WHERE id=$1")
        .bind(&deal.id)
        .fetch_one(&mut *connection)
        .await?;
    crate::webhooks::enqueue_event_conn(connection, "deal.transitioned", &updated).await?;
    Ok(())
}

pub async fn create_deal(
    state: &AppState,
    seller: &str,
    req: CreateDealRequest,
    key: Option<&str>,
) -> Result<Deal, ApiError> {
    let hash = hex::encode(Sha256::digest(
        serde_json::to_vec(&req).map_err(|_| ApiError::bad_request("invalid request"))?,
    ));
    let mut tx = state.pool.begin().await?;
    let scoped_key = key.map(|key| hex::encode(Sha256::digest(format!("{seller}:/deals:{key}"))));
    if let Some(key) = &scoped_key {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(key)
            .execute(&mut *tx)
            .await?;
        let existing: Option<(String, serde_json::Value)> =
            sqlx::query_as("SELECT request_hash,response_body FROM idempotency_keys WHERE key=$1")
                .bind(key)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some((prior, body)) = existing {
            if prior != hash {
                return Err(ApiError::conflict_with_code(
                    "Idempotency-Key reused with another request",
                    "idempotency_conflict",
                ));
            }
            return finish(
                tx,
                body["id"]
                    .as_str()
                    .ok_or_else(|| ApiError::Internal("invalid idempotency record".into()))?,
            )
            .await;
        }
    }
    let seller = normalize_identity(seller).map_err(ApiError::from)?;
    let buyer = normalize_identity(&req.buyer_pubkey).map_err(ApiError::from)?;
    let mediator = normalize_identity(&req.mediator_pubkey).map_err(ApiError::from)?;
    if req
        .seller_pubkey
        .as_deref()
        .map(normalize_identity)
        .transpose()
        .map_err(ApiError::from)?
        .is_some_and(|value| value != seller)
    {
        return Err(ApiError::forbidden(
            "seller must match authenticated identity",
        ));
    }
    if !state.mediator_pubkeys.is_empty() && !state.mediator_pubkeys.contains(&mediator) {
        return Err(ApiError::bad_request("mediator is not configured"));
    }
    for (role,key) in [("seller",seller.as_str()),("buyer",buyer.as_str()),("mediator",mediator.as_str())] { assert_allowlisted(state,role,key)?; }
    opendeal_bitcoin::FeeDustPolicy::default().validate_deal_amount(req.amount_sats).map_err(|error| ApiError::bad_request(error.to_string()))?;
    if state.config.pilot_max_amount_sats.is_some_and(|max| req.amount_sats>max) { return Err(ApiError::bad_request("deal exceeds PILOT_MAX_AMOUNT_SATS")); }
    let model = state.settlement.settlement_model();
    if model != opendeal_core::SettlementModel::BitcoinMultisig2of3 {
        return Err(ApiError::bad_request(
            "only bitcoin_multisig_2of3 has an implemented settlement lifecycle; provider adapters remain stubs",
        ));
    }
    if req
        .network
        .as_deref()
        .is_some_and(|network| network != state.config.bitcoin_network)
        || req
            .settlement_model
            .as_deref()
            .is_some_and(|value| value != model.as_str())
    {
        return Err(ApiError::bad_request(
            "network or settlement model does not match server configuration",
        ));
    }
    if req.title.trim().is_empty()
        || req.title.len() > 256
        || req.description.as_ref().is_some_and(|v| v.len() > 10_000)
        || req.amount_sats == 0
        || req.amount_sats > 2_100_000_000_000_000
        || req.acceptance_window_hours == 0
        || req.acceptance_window_hours > 8760
        || req.delivery_deadline <= Utc::now()
        || req.currency.as_deref().is_some_and(|v| v != "BTC")
    {
        return Err(ApiError::bad_request(
            "invalid title, description, amount, currency, deadline or acceptance window",
        ));
    }
    let network = opendeal_bitcoin::escrow::parse_network(&state.config.bitcoin_network)
        .map_err(|e| ApiError::bad_request(e.to_string()))?;
    for address in [&req.seller_payout_address, &req.buyer_refund_address]
        .into_iter()
        .flatten()
    {
        address
            .parse::<bitcoin::Address<bitcoin::address::NetworkUnchecked>>()
            .map_err(|_| ApiError::bad_request("invalid settlement address"))?
            .require_network(network)
            .map_err(|_| ApiError::bad_request("settlement address network mismatch"))?;
    }
    let agreement = Agreement {
        version: Agreement::CURRENT_VERSION,
        title: req.title,
        description: req.description,
        seller_payout_address: req.seller_payout_address,
        buyer_refund_address: req.buyer_refund_address,
        amount_sats: req.amount_sats,
        currency: "BTC".into(),
        seller_pubkey: seller.clone(),
        buyer_pubkey: buyer,
        mediator_pubkey: mediator,
        delivery_deadline: req.delivery_deadline,
        acceptance_window_hours: req.acceptance_window_hours,
        settlement_model: model,
        network: state.config.bitcoin_network.clone(),
        created_at: Utc::now(),
    };
    let id = agreement.agreement_id().map_err(ApiError::from)?;
    sqlx::query("INSERT INTO deals (id,status,title,amount_sats,currency,seller_pubkey,buyer_pubkey,mediator_pubkey,settlement_model,network,agreement_json,delivery_deadline,acceptance_window_hours) VALUES ($1,'draft',$2,$3,'BTC',$4,$5,$6,$7,$8,$9,$10,$11)")
        .bind(&id).bind(&agreement.title).bind(agreement.amount_sats as i64).bind(&seller).bind(&agreement.buyer_pubkey).bind(&agreement.mediator_pubkey)
        .bind(model.as_str()).bind(&agreement.network).bind(serde_json::to_value(&agreement).map_err(|e| ApiError::Internal(e.to_string()))?)
        .bind(agreement.delivery_deadline).bind(agreement.acceptance_window_hours as i32).execute(&mut *tx).await?;
    append_event_conn(
        &mut tx,
        &id,
        EventKind::DealCreated,
        EventPayload::DealCreated {
            agreement_id: id.clone(),
        },
        &seller,
        None,
    )
    .await?;
    let created: Deal = sqlx::query_as("SELECT * FROM deals WHERE id=$1")
        .bind(&id)
        .fetch_one(&mut *tx)
        .await?;
    crate::webhooks::enqueue_event_conn(&mut tx, "deal.created", &created).await?;
    if let Some(key) = scoped_key {
        sqlx::query("INSERT INTO idempotency_keys (key,route,request_hash,response_status,response_body) VALUES ($1,'/deals',$2,200,$3)")
            .bind(key).bind(hash).bind(serde_json::json!({"id":id})).execute(&mut *tx).await?;
    }
    let updated = finish(tx, &id).await?;
    let _ = crate::mail::notify_deal_parties(state, "deal.created", &updated).await;
    Ok(updated)
}

pub async fn sign_agreement(
    state: &AppState,
    id: &str,
    actor: &str,
    signature: Signature,
) -> Result<Deal, ApiError> {
    let (mut tx, deal) = locked(state, id, actor).await?;
    if !is_buyer(&deal, actor) && !is_seller(&deal, actor) {
        return Err(ApiError::forbidden(
            "only buyer and seller sign the agreement",
        ));
    }
    verify_agreement_signature(&agreement(&deal)?, &signature).map_err(ApiError::from)?;
    if normalize_identity(&signature.pubkey).map_err(ApiError::from)? != actor {
        return Err(ApiError::forbidden("signature identity mismatch"));
    }
    let existing: Option<(serde_json::Value,)> = sqlx::query_as(
        "SELECT signature_json FROM agreement_signatures WHERE agreement_id=$1 AND pubkey=$2",
    )
    .bind(id)
    .bind(actor)
    .fetch_optional(&mut *tx)
    .await?;
    if existing.is_some() {
        return finish(tx, id).await;
    }
    if deal.status != "draft" {
        return Err(ApiError::conflict_with_code(
            "agreement is frozen",
            "illegal_transition",
        ));
    }
    sqlx::query(
        "INSERT INTO agreement_signatures (agreement_id,pubkey,signature_json) VALUES ($1,$2,$3)",
    )
    .bind(id)
    .bind(actor)
    .bind(serde_json::to_value(signature).map_err(|e| ApiError::Internal(e.to_string()))?)
    .execute(&mut *tx)
    .await?;
    // An agreement signature signs the agreement, not the event's signing bytes.
    append_event_conn(
        &mut tx,
        id,
        EventKind::AgreementSigned,
        EventPayload::AgreementSigned {
            role: if is_buyer(&deal, actor) {
                "buyer"
            } else {
                "seller"
            }
            .into(),
            pubkey: actor.into(),
        },
        actor,
        None,
    )
    .await?;
    if has_agreement_consent(&mut tx, &deal).await? {
        set_status(&mut tx, &deal, DealStatus::Agreed, actor).await?;
    }
    finish(tx, id).await
}

pub async fn transition_deal(
    state: &AppState,
    id: &str,
    actor: &str,
    to: DealStatus,
) -> Result<Deal, ApiError> {
    let (mut tx, deal) = locked(state, id, actor).await?;
    let allowed = match to {
        DealStatus::Shipped => is_seller(&deal, actor) && deal.status == "funded",
        DealStatus::Accepted => is_buyer(&deal, actor) && deal.status == "shipped",
        DealStatus::Cancelled => {
            (is_seller(&deal, actor) || is_buyer(&deal, actor))
                && ["draft", "agreed"].contains(&deal.status.as_str())
        }
        _ => false,
    };
    if !allowed {
        return Err(ApiError::forbidden(
            "transition requires the dedicated workflow endpoint and authorized role",
        ));
    }
    if deal.settlement_txid.is_some() || deal.current_psbt.is_some() {
        return Err(ApiError::conflict_with_code(
            "settlement is in progress",
            "settlement_locked",
        ));
    }
    set_status(&mut tx, &deal, to, actor).await?;
    let updated = finish(tx, id).await?;
    let _ = crate::mail::notify_deal_parties(state, "deal.transitioned", &updated).await;
    Ok(updated)
}

pub fn escrow(deal: &Deal) -> Result<EscrowDescriptor, ApiError> {
    let descriptor = EscrowKeys {
        buyer_pubkey: deal.buyer_pubkey.clone(),
        seller_pubkey: deal.seller_pubkey.clone(),
        mediator_pubkey: deal.mediator_pubkey.clone(),
    }
    .build_escrow(
        opendeal_bitcoin::escrow::parse_network(&deal.network)
            .map_err(|e| ApiError::bad_request(e.to_string()))?,
    )
    .map_err(|e| ApiError::bad_request(e.to_string()))?;
    Ok(descriptor)
}

pub async fn prepare_funding(state: &AppState, id: &str, actor: &str) -> Result<Deal, ApiError> {
    let (mut tx, deal) = locked(state, id, actor).await?;
    if !["agreed", "awaiting_payment"].contains(&deal.status.as_str()) {
        return Err(ApiError::conflict_with_code(
            "agreement must be signed before escrow preparation",
            "illegal_transition",
        ));
    }
    if !has_agreement_consent(&mut tx, &deal).await? {
        return Err(ApiError::conflict_with_code(
            "both valid buyer and seller agreement signatures are required",
            "agreement_not_signed",
        ));
    }
    state
        .rpc
        .check_network(&deal.network)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;
    if deal.status == "awaiting_payment" {
        return finish(tx, id).await;
    }
    let descriptor = escrow(&deal)?;
    sqlx::query("UPDATE deals SET escrow_address=$2,escrow_script_pubkey_hex=$3,escrow_witness_script_hex=$4 WHERE id=$1")
        .bind(id).bind(&descriptor.address).bind(&descriptor.script_pubkey_hex).bind(&descriptor.witness_script_hex).execute(&mut *tx).await?;
    append_event_conn(
        &mut tx,
        id,
        EventKind::EscrowPrepared,
        EventPayload::EscrowPrepared {
            address: descriptor.address,
        },
        actor,
        None,
    )
    .await?;
    set_status(&mut tx, &deal, DealStatus::AwaitingPayment, actor).await?;
    finish(tx, id).await
}

pub async fn verify_funding(state: &AppState, id: &str, actor: &str) -> Result<Deal, ApiError> {
    let (mut tx, deal) = locked(state, id, actor).await?;
    if deal.status != "awaiting_payment" {
        return Err(ApiError::conflict_with_code(
            "funding verification requires awaiting_payment",
            "illegal_transition",
        ));
    }
    if !has_agreement_consent(&mut tx, &deal).await? {
        return Err(ApiError::conflict_with_code(
            "both valid buyer and seller agreement signatures are required",
            "agreement_not_signed",
        ));
    }
    state
        .rpc
        .check_network(&deal.network)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;
    let descriptor = escrow(&deal)?;
    let utxos = state
        .rpc
        .scan_address_utxos(&descriptor.address)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;
    for utxo in utxos {
        if utxo.script_pubkey_hex != descriptor.script_pubkey_hex
            || utxo.amount_sats > 2_100_000_000_000_000
            || utxo.amount_sats < deal.amount_sats as u64
        {
            continue;
        }
        let claimed: (bool,) = sqlx::query_as("SELECT EXISTS(SELECT 1 FROM deals WHERE funding_txid=$1 AND funding_vout=$2 AND id<>$3)")
            .bind(&utxo.txid).bind(utxo.vout as i32).bind(id).fetch_one(&mut *tx).await?;
        if claimed.0 {
            continue;
        }
        let changed = deal.funding_txid.as_deref() != Some(&utxo.txid)
            || deal.funding_vout != Some(utxo.vout as i32);
        sqlx::query(
            "UPDATE deals SET funding_txid=$2,funding_vout=$3,funding_amount_sats=$4 WHERE id=$1",
        )
        .bind(id)
        .bind(&utxo.txid)
        .bind(utxo.vout as i32)
        .bind(utxo.amount_sats as i64)
        .execute(&mut *tx)
        .await?;
        if changed {
            append_event_conn(
                &mut tx,
                id,
                EventKind::FundingDetected,
                EventPayload::FundingDetected {
                    txid: utxo.txid.clone(),
                    vout: utxo.vout,
                    amount_sats: utxo.amount_sats,
                },
                actor,
                None,
            )
            .await?;
        }
        if utxo.confirmations >= state.config.bitcoin_required_confirmations {
            append_event_conn(
                &mut tx,
                id,
                EventKind::FundingConfirmed,
                EventPayload::FundingConfirmed {
                    txid: utxo.txid,
                    vout: utxo.vout,
                    confirmations: utxo.confirmations,
                },
                actor,
                None,
            )
            .await?;
            set_status(&mut tx, &deal, DealStatus::Funded, actor).await?;
        }
        break;
    }
    finish(tx, id).await
}

fn purpose(raw: &str) -> Result<SettlementPurpose, ApiError> {
    match raw {
        "payout_seller" => Ok(SettlementPurpose::PayoutSeller),
        "refund_buyer" => Ok(SettlementPurpose::RefundBuyer),
        _ => Err(ApiError::bad_request(
            "purpose must be payout_seller or refund_buyer",
        )),
    }
}

async fn authorize_settlement(
    connection: &mut PgConnection,
    deal: &Deal,
    purpose: SettlementPurpose,
) -> Result<(), ApiError> {
    if !has_agreement_consent(connection, deal).await? {
        return Err(ApiError::conflict_with_code(
            "both agreement signatures are required",
            "agreement_not_signed",
        ));
    }
    if deal.status == "accepted" && purpose == SettlementPurpose::PayoutSeller {
        return Ok(());
    }
    if deal.status == "disputed" {
        let decision: Option<(String,)> = sqlx::query_as("SELECT decision FROM disputes WHERE agreement_id=$1 AND status='resolved' ORDER BY resolved_at DESC LIMIT 1").bind(&deal.id).fetch_optional(connection).await?;
        let expected = if purpose == SettlementPurpose::PayoutSeller {
            "release"
        } else {
            "refund"
        };
        if decision.is_some_and(|row| row.0 == expected) {
            return Ok(());
        }
    }
    Err(ApiError::conflict_with_code(
        "settlement requires buyer acceptance or matching mediator resolution",
        "settlement_not_authorized",
    ))
}

fn check_fee(state: &AppState, amount: u64, fee: u64) -> Result<(), ApiError> {
    if fee == 0
        || fee >= amount
        || fee > state.config.bitcoin_max_fee_sats
        || u128::from(fee) * 10_000
            > u128::from(amount) * u128::from(state.config.bitcoin_max_fee_bps)
    {
        return Err(ApiError::bad_request(
            "fee exceeds configured absolute or relative limit",
        ));
    }
    Ok(())
}

fn destination(deal: &Deal, purpose: SettlementPurpose) -> Result<String, ApiError> {
    let agreement = agreement(deal)?;
    let address = if purpose == SettlementPurpose::PayoutSeller {
        agreement.seller_payout_address
    } else {
        agreement.buyer_refund_address
    };
    address.ok_or_else(|| {
        ApiError::bad_request(
            "agreement has no signed destination for this purpose; create and sign a new agreement",
        )
    })
}

async fn verify_outpoint(state: &AppState, deal: &Deal) -> Result<(), ApiError> {
    state
        .rpc
        .check_network(&deal.network)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;
    let txid = deal
        .funding_txid
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("missing funding txid"))?;
    let vout = deal
        .funding_vout
        .ok_or_else(|| ApiError::bad_request("missing funding vout"))?;
    let utxo = state
        .rpc
        .get_tx_out(txid, vout as u32)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?
        .ok_or_else(|| {
            ApiError::conflict_with_code(
                "funding output is spent or unavailable",
                "funding_unavailable",
            )
        })?;
    if utxo.script_pubkey_hex != escrow(deal)?.script_pubkey_hex
        || Some(utxo.amount_sats as i64) != deal.funding_amount_sats
        || utxo.confirmations < state.config.bitcoin_required_confirmations
    {
        return Err(ApiError::bad_request(
            "funding script, amount or confirmations changed",
        ));
    }
    Ok(())
}

pub async fn propose_settlement(
    state: &AppState,
    id: &str,
    actor: &str,
    target: &str,
    fee: u64,
    raw_purpose: &str,
) -> Result<Deal, ApiError> {
    let (mut tx, deal) = locked(state, id, actor).await?;
    let purpose = purpose(raw_purpose)?;
    authorize_settlement(&mut tx, &deal, purpose).await?;
    if deal.settlement_txid.is_some() {
        return Err(ApiError::conflict_with_code(
            "broadcast already attempted",
            "settlement_locked",
        ));
    }
    if target != destination(&deal, purpose)? {
        return Err(ApiError::bad_request(
            "destination contradicts signed agreement",
        ));
    }
    let amount = deal
        .funding_amount_sats
        .ok_or_else(|| ApiError::bad_request("missing funding amount"))? as u64;
    check_fee(state, amount, fee)?;
    verify_outpoint(state, &deal).await?;
    let psbt = build_settlement_psbt(
        &escrow(&deal)?,
        deal.funding_txid.as_deref().unwrap(),
        deal.funding_vout.unwrap() as u32,
        amount,
        target,
        fee,
        purpose,
    )
    .map_err(|e| ApiError::bad_request(e.to_string()))?;
    if let Some(prior) = &deal.settlement_proposal {
        if prior == &psbt.psbt_base64 {
            return finish(tx, id).await;
        }
        return Err(ApiError::conflict_with_code(
            "proposal is immutable; cannot replace signed transaction terms",
            "settlement_locked",
        ));
    }
    sqlx::query("UPDATE deals SET current_psbt=$2,settlement_proposal=$2,settlement_purpose=$3,settlement_phase='proposed' WHERE id=$1")
        .bind(id).bind(&psbt.psbt_base64).bind(raw_purpose).execute(&mut *tx).await?;
    append_event_conn(
        &mut tx,
        id,
        EventKind::SettlementProposed,
        EventPayload::SettlementProposed {
            psbt_base64: psbt.psbt_base64,
            purpose: raw_purpose.into(),
        },
        actor,
        None,
    )
    .await?;
    finish(tx, id).await
}

fn checked_psbt(state: &AppState, deal: &Deal) -> Result<String, ApiError> {
    let base = deal
        .settlement_proposal
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("no settlement proposal"))?;
    let parsed = psbt_from_base64(base).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let amount = deal
        .funding_amount_sats
        .ok_or_else(|| ApiError::bad_request("missing funding amount"))? as u64;
    if parsed.unsigned_tx.output.len() != 1 {
        return Err(ApiError::bad_request("unexpected settlement outputs"));
    }
    let fee = amount
        .checked_sub(parsed.unsigned_tx.output[0].value.to_sat())
        .ok_or_else(|| ApiError::bad_request("invalid settlement amount"))?;
    check_fee(state, amount, fee)?;
    let purpose = purpose(deal.settlement_purpose.as_deref().unwrap_or_default())?;
    let expected = build_settlement_psbt(
        &escrow(deal)?,
        deal.funding_txid
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("missing funding txid"))?,
        deal.funding_vout
            .ok_or_else(|| ApiError::bad_request("missing vout"))? as u32,
        amount,
        &destination(deal, purpose)?,
        fee,
        purpose,
    )
    .map_err(|e| ApiError::bad_request(e.to_string()))?;
    if psbt_from_base64(&expected.psbt_base64).map_err(|e| ApiError::bad_request(e.to_string()))?
        != parsed
    {
        return Err(ApiError::bad_request(
            "stored proposal contradicts authorized settlement",
        ));
    }
    validated_combine(
        base,
        deal.current_psbt
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("missing current PSBT"))?,
    )
    .map_err(|e| ApiError::bad_request(e.to_string()))
}

pub async fn attach_psbt_signature(
    state: &AppState,
    id: &str,
    actor: &str,
    update: &str,
) -> Result<Deal, ApiError> {
    let (mut tx, deal) = locked(state, id, actor).await?;
    authorize_settlement(
        &mut tx,
        &deal,
        purpose(deal.settlement_purpose.as_deref().unwrap_or_default())?,
    )
    .await?;
    if deal.settlement_txid.is_some() {
        return Err(ApiError::conflict_with_code(
            "broadcast already attempted",
            "settlement_locked",
        ));
    }
    let base = checked_psbt(state, &deal)?;
    let combined =
        validated_combine(&base, update).map_err(|e| ApiError::bad_request(e.to_string()))?;
    sqlx::query("UPDATE deals SET current_psbt=$2,updated_at=now() WHERE id=$1")
        .bind(id)
        .bind(combined)
        .execute(&mut *tx)
        .await?;
    finish(tx, id).await
}

pub async fn finalize_settlement(
    state: &AppState,
    id: &str,
    actor: &str,
) -> Result<Deal, ApiError> {
    let (mut tx, deal) = locked(state, id, actor).await?;
    // Durable deterministic txid makes repeats observational, including after a timeout/crash.
    if deal.settlement_txid.is_some() {
        return finish(tx, id).await;
    }
    authorize_settlement(
        &mut tx,
        &deal,
        purpose(deal.settlement_purpose.as_deref().unwrap_or_default())?,
    )
    .await?;
    verify_outpoint(state, &deal).await?;
    let base = checked_psbt(state, &deal)?;
    let finalized = finalize_validated(&base).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let raw = extract_tx_hex(&finalized).map_err(|e| ApiError::bad_request(e.to_string()))?;
    let transaction: bitcoin::Transaction = bitcoin::consensus::encode::deserialize_hex(&raw)
        .map_err(|_| ApiError::bad_request("invalid final transaction"))?;
    let txid = transaction.compute_txid().to_string();
    sqlx::query("UPDATE deals SET settlement_txid=$2,settlement_raw_tx=$3,settlement_from_status=status,settlement_phase='broadcasting',broadcast_attempted_at=now() WHERE id=$1")
        .bind(id).bind(&txid).bind(&raw).execute(&mut *tx).await?;
    append_event_conn(
        &mut tx,
        id,
        EventKind::SettlementBroadcastRequested,
        EventPayload::SettlementBroadcastRequested { txid: txid.clone() },
        actor,
        None,
    )
    .await?;
    tx.commit().await?; // Write ahead of the irreversible network side effect.
    let result = state.rpc.broadcast_hex(&raw).await;
    let (mut tx, current) = locked(state, id, actor).await?;
    match result {
        Ok(actual) if actual == txid => {
            if current.settlement_phase == "broadcasting" {
                sqlx::query("UPDATE deals SET settlement_phase='broadcast' WHERE id=$1")
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                append_event_conn(
                    &mut tx,
                    id,
                    EventKind::SettlementBroadcast,
                    EventPayload::SettlementBroadcast { txid },
                    actor,
                    None,
                )
                .await?;
            }
            finish(tx, id).await
        }
        failure => {
            let rejected = matches!(
                failure,
                Err(opendeal_bitcoin::BitcoinError::RpcCode(-26 | -22))
            );
            if current.settlement_phase == "broadcasting" {
                sqlx::query("UPDATE deals SET settlement_phase=$2 WHERE id=$1")
                    .bind(id)
                    .bind(if rejected {
                        "broadcast_rejected"
                    } else {
                        "broadcast_unknown"
                    })
                    .execute(&mut *tx)
                    .await?;
            }
            tx.commit().await?;
            Err(ApiError::conflict_with_code(
                if rejected {
                    "Core rejected the stored transaction; inspect it before manual recovery"
                } else {
                    "broadcast result uncertain; reconcile the stored txid before recovery; do not create another funded deal"
                },
                if rejected {
                    "broadcast_rejected"
                } else {
                    "broadcast_unconfirmed"
                },
            ))
        }
    }
}

pub async fn confirm_settlement(
    state: &AppState,
    id: &str,
    actor: &str,
    hint: Option<&str>,
) -> Result<Deal, ApiError> {
    let (mut tx, deal) = locked(state, id, actor).await?;
    let txid = deal
        .settlement_txid
        .as_deref()
        .ok_or_else(|| ApiError::bad_request("no settlement broadcast intent"))?;
    let raw = deal
        .settlement_raw_tx
        .as_deref()
        .ok_or_else(|| ApiError::Internal("missing durable settlement transaction".into()))?;
    let stored_tx: bitcoin::Transaction = bitcoin::consensus::encode::deserialize_hex(raw)
        .map_err(|_| ApiError::Internal("invalid durable settlement transaction".into()))?;
    if stored_tx.compute_txid().to_string() != txid {
        return Err(ApiError::Internal("settlement txid mismatch".into()));
    }
    state
        .rpc
        .check_network(&deal.network)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;
    // Prefer an explicit new block after re-inclusion, otherwise recheck the stored block.
    let mut observed = state
        .rpc
        .transaction_status(txid, deal.settlement_block_hash.as_deref().or(hint))
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;
    // A client hint cannot invalidate an existing active-chain confirmation.
    if observed.confirmations == 0
        && hint.is_some()
        && hint != deal.settlement_block_hash.as_deref()
    {
        observed = state
            .rpc
            .transaction_status(txid, hint)
            .await
            .map_err(|e| ApiError::bad_request(e.to_string()))?;
    }
    let confirmed =
        observed.found && observed.confirmations >= state.config.bitcoin_required_confirmations;
    let phase = if confirmed {
        "confirmed"
    } else if observed.found {
        "broadcast"
    } else if deal.settlement_phase == "broadcast_rejected" {
        "broadcast_rejected"
    } else {
        "broadcast_unknown"
    };
    sqlx::query("UPDATE deals SET settlement_phase=$2,settlement_confirmations=$3,settlement_block_hash=$4,updated_at=now() WHERE id=$1")
        .bind(id).bind(phase).bind(observed.confirmations as i32).bind(&observed.block_hash).execute(&mut *tx).await?;
    if confirmed && deal.settlement_phase != "confirmed" {
        let next = if deal.settlement_purpose.as_deref() == Some("refund_buyer") {
            DealStatus::Refunded
        } else {
            DealStatus::Settled
        };
        append_event_conn(
            &mut tx,
            id,
            EventKind::SettlementConfirmed,
            EventPayload::SettlementConfirmed {
                txid: txid.into(),
                confirmations: observed.confirmations,
                block_hash: observed.block_hash,
            },
            actor,
            None,
        )
        .await?;
        set_status(&mut tx, &deal, next, actor).await?;
    } else if !confirmed && deal.settlement_phase == "confirmed" {
        let previous = deal
            .settlement_from_status
            .as_deref()
            .ok_or_else(|| ApiError::Internal("missing pre-settlement state".into()))?;
        append_event_conn(
            &mut tx,
            id,
            EventKind::SettlementReorged,
            EventPayload::SettlementReorged { txid: txid.into() },
            actor,
            None,
        )
        .await?;
        sqlx::query("UPDATE deals SET status=$2 WHERE id=$1")
            .bind(id)
            .bind(previous)
            .execute(&mut *tx)
            .await?;
        let previous: DealStatus =
            serde_json::from_value(serde_json::Value::String(previous.into()))
                .map_err(|_| ApiError::Internal("invalid previous state".into()))?;
        append_event_conn(
            &mut tx,
            id,
            EventKind::StatusTransitioned,
            EventPayload::StatusTransitioned {
                from: deal.status_enum().map_err(ApiError::bad_request)?,
                to: previous,
            },
            actor,
            None,
        )
        .await?;
    }
    finish(tx, id).await
}

pub async fn export_receipt(state: &AppState, id: &str) -> Result<DealReceipt, ApiError> {
    // A repeatable-read snapshot prevents mixing concurrent signature/event/status versions.
    let mut tx = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    let deal: Deal = sqlx::query_as("SELECT * FROM deals WHERE id=$1")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| ApiError::not_found("deal not found"))?;
    let rows: Vec<(serde_json::Value,)> = sqlx::query_as(
        "SELECT signature_json FROM agreement_signatures WHERE agreement_id=$1 ORDER BY pubkey",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    let events = super::events::list_events_conn(&mut tx, id).await?;
    let receipt = DealReceipt {
        agreement: agreement(&deal)?,
        agreement_id: id.into(),
        status: deal.status_enum().map_err(ApiError::bad_request)?,
        settlement_model: parse_settlement_model(&deal.settlement_model),
        network: deal.network,
        agreement_signatures: rows
            .into_iter()
            .map(|row| serde_json::from_value(row.0))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| ApiError::Internal(e.to_string()))?,
        events,
        funding_txid: deal.funding_txid,
        settlement_txid: deal.settlement_txid,
    };
    receipt.verify().map_err(ApiError::from)?;
    tx.commit().await?;
    Ok(receipt)
}

pub fn signing_progress(deal: &Deal) -> Result<usize, ApiError> {
    deal.current_psbt
        .as_deref()
        .map(|base| {
            psbt_from_base64(base)
                .and_then(|psbt| validate_partial_signatures(&psbt))
                .map_err(|e| ApiError::bad_request(e.to_string()))
        })
        .transpose()
        .map(|count| count.unwrap_or(0))
}

fn norm_pubkey(pubkey: &str) -> String {
    let lower = pubkey.to_ascii_lowercase();
    if lower.len() == 66 && (lower.starts_with("02") || lower.starts_with("03")) {
        return lower[2..].to_string();
    }
    return lower;
}

fn assert_allowlisted(state: &AppState, role: &str, pubkey: &str) -> Result<(), ApiError> {
    if state.config.allowed_pubkeys.is_empty() {
        return Ok(());
    }
    let actor = norm_pubkey(pubkey);
    let allowed = state
        .config
        .allowed_pubkeys
        .iter()
        .any(|pk| norm_pubkey(pk) == actor);
    if !allowed {
        return Err(ApiError::bad_request(format!(
            "{role} is not on OPENDEAL_ALLOWED_PUBKEYS"
        )));
    }
    return Ok(());
}


#[derive(Debug, serde::Serialize)]
pub struct Reputation {
    pub pubkey: String,
    pub deals_as_seller: i64,
    pub deals_as_buyer: i64,
    pub settled: i64,
    pub refunded: i64,
    pub disputed: i64,
}

pub async fn reputation(pool: &PgPool, pubkey: &str) -> Result<Reputation, ApiError> {
    let key = norm_pubkey(pubkey);
    let row: (i64, i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
          COUNT(*) FILTER (WHERE RIGHT(LOWER(seller_pubkey), 64) = $1),
          COUNT(*) FILTER (WHERE RIGHT(LOWER(buyer_pubkey), 64) = $1),
          COUNT(*) FILTER (
            WHERE status = 'settled'
              AND (RIGHT(LOWER(seller_pubkey), 64) = $1 OR RIGHT(LOWER(buyer_pubkey), 64) = $1)
          ),
          COUNT(*) FILTER (
            WHERE status = 'refunded'
              AND (RIGHT(LOWER(seller_pubkey), 64) = $1 OR RIGHT(LOWER(buyer_pubkey), 64) = $1)
          ),
          COUNT(*) FILTER (
            WHERE status = 'disputed'
              AND (RIGHT(LOWER(seller_pubkey), 64) = $1 OR RIGHT(LOWER(buyer_pubkey), 64) = $1)
          )
        FROM deals
        "#,
    )
    .bind(&key)
    .fetch_one(pool)
    .await?;
    return Ok(Reputation {
        pubkey: key,
        deals_as_seller: row.0,
        deals_as_buyer: row.1,
        settled: row.2,
        refunded: row.3,
        disputed: row.4,
    });
}
