use chrono::Utc;
use opendeal_bitcoin::{EscrowDescriptor, EscrowKeys, SettlementPurpose};
use opendeal_core::{
    Agreement, DealReceipt, DealStatus, EventKind, EventPayload, Signature,
    verify_agreement_signature,
};
use sqlx::PgPool;

use crate::error::ApiError;
use crate::state::AppState;
use crate::webhooks;

use super::events::{append_event, list_events};
use super::models::{CreateDealRequest, Deal, parse_settlement_model};

pub async fn create_deal(
    state: &AppState,
    seller_pubkey: &str,
    req: CreateDealRequest,
) -> Result<Deal, ApiError> {
    if req.buyer_pubkey == seller_pubkey {
        return Err(ApiError::bad_request("buyer and seller must differ"));
    }
    let model = state.settlement.settlement_model();
    let agreement = Agreement {
        version: Agreement::CURRENT_VERSION,
        description: None,
        seller_payout_address: None,
        buyer_refund_address: None,
        title: req.title.clone(),
        amount_sats: req.amount_sats,
        currency: req.currency.unwrap_or_else(|| "BTC".into()),
        seller_pubkey: seller_pubkey.to_string(),
        buyer_pubkey: req.buyer_pubkey.clone(),
        mediator_pubkey: req.mediator_pubkey.clone(),
        delivery_deadline: req.delivery_deadline,
        acceptance_window_hours: req.acceptance_window_hours,
        settlement_model: model,
        network: state.config.bitcoin_network.clone(),
        created_at: Utc::now(),
    };
    agreement.validate().map_err(ApiError::from)?;
    let id = agreement.agreement_id().map_err(ApiError::from)?;
    let agreement_json =
        serde_json::to_value(&agreement).map_err(|e| ApiError::Internal(e.to_string()))?;

    let deal = sqlx::query_as::<_, Deal>(
        r#"
        INSERT INTO deals (
            id, status, title, amount_sats, currency, seller_pubkey, buyer_pubkey, mediator_pubkey,
            settlement_model, network, agreement_json, delivery_deadline, acceptance_window_hours
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id, status, title, amount_sats, currency, seller_pubkey, buyer_pubkey, mediator_pubkey,
                  settlement_model, network, escrow_address, funding_txid, funding_vout, funding_amount_sats,
                  settlement_txid, current_psbt, delivery_deadline, acceptance_window_hours, created_at, updated_at
        "#,
    )
    .bind(&id)
    .bind(DealStatus::Draft.as_str())
    .bind(&agreement.title)
    .bind(agreement.amount_sats as i64)
    .bind(&agreement.currency)
    .bind(&agreement.seller_pubkey)
    .bind(&agreement.buyer_pubkey)
    .bind(&agreement.mediator_pubkey)
    .bind(model.as_str())
    .bind(&agreement.network)
    .bind(&agreement_json)
    .bind(agreement.delivery_deadline)
    .bind(agreement.acceptance_window_hours as i32)
    .fetch_one(&state.pool)
    .await?;

    append_event(
        &state.pool,
        &id,
        EventKind::DealCreated,
        EventPayload::DealCreated {
            agreement_id: id.clone(),
        },
        seller_pubkey,
        None,
    )
    .await?;

    webhooks::enqueue_deal_event(state, "deal.created", &deal).await?;
    return Ok(deal);
}

pub async fn get_deal(pool: &PgPool, id: &str) -> Result<Deal, ApiError> {
    return sqlx::query_as::<_, Deal>(
        r#"
        SELECT id, status, title, amount_sats, currency, seller_pubkey, buyer_pubkey, mediator_pubkey,
               settlement_model, network, escrow_address, funding_txid, funding_vout, funding_amount_sats,
               settlement_txid, current_psbt, delivery_deadline, acceptance_window_hours, created_at, updated_at
        FROM deals WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::not_found("deal not found"));
}

pub async fn load_agreement(pool: &PgPool, id: &str) -> Result<Agreement, ApiError> {
    let row: (serde_json::Value,) =
        sqlx::query_as("SELECT agreement_json FROM deals WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or_else(|| ApiError::not_found("deal not found"))?;
    return serde_json::from_value(row.0).map_err(|e| ApiError::Internal(e.to_string()));
}

fn assert_party(deal: &Deal, pubkey: &str) -> Result<(), ApiError> {
    if pubkey == deal.seller_pubkey || pubkey == deal.buyer_pubkey || pubkey == deal.mediator_pubkey
    {
        return Ok(());
    }
    return Err(ApiError::forbidden("not a party to this deal"));
}

pub async fn sign_agreement(
    state: &AppState,
    id: &str,
    actor: &str,
    signature: Signature,
) -> Result<Deal, ApiError> {
    let deal = get_deal(&state.pool, id).await?;
    assert_party(&deal, actor)?;
    let agreement = load_agreement(&state.pool, id).await?;
    verify_agreement_signature(&agreement, &signature).map_err(ApiError::from)?;
    if !signature.pubkey.eq_ignore_ascii_case(actor)
        && !(signature.pubkey.len() == 66 && actor.eq_ignore_ascii_case(&signature.pubkey[2..]))
    {
        return Err(ApiError::forbidden(
            "signature pubkey must match authenticated user",
        ));
    }

    let sig_json =
        serde_json::to_value(&signature).map_err(|e| ApiError::Internal(e.to_string()))?;
    sqlx::query(
        r#"
        INSERT INTO agreement_signatures (agreement_id, pubkey, signature_json)
        VALUES ($1, $2, $3)
        ON CONFLICT (agreement_id, pubkey) DO UPDATE SET signature_json = EXCLUDED.signature_json
        "#,
    )
    .bind(id)
    .bind(actor)
    .bind(&sig_json)
    .execute(&state.pool)
    .await?;

    append_event(
        &state.pool,
        id,
        EventKind::AgreementSigned,
        EventPayload::AgreementSigned {
            role: if actor == deal.seller_pubkey {
                "seller".into()
            } else if actor == deal.buyer_pubkey {
                "buyer".into()
            } else {
                "mediator".into()
            },
            pubkey: actor.to_string(),
        },
        actor,
        Some(signature),
    )
    .await?;

    let sig_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM agreement_signatures WHERE agreement_id = $1")
            .bind(id)
            .fetch_one(&state.pool)
            .await?;

    // Buyer + seller signatures move draft -> agreed.
    if sig_count.0 >= 2 && deal.status == DealStatus::Draft.as_str() {
        return transition_deal(state, id, actor, DealStatus::Agreed).await;
    }
    return get_deal(&state.pool, id).await;
}

pub async fn transition_deal(
    state: &AppState,
    id: &str,
    actor: &str,
    to: DealStatus,
) -> Result<Deal, ApiError> {
    let deal = get_deal(&state.pool, id).await?;
    assert_party(&deal, actor)?;
    let from = deal.status_enum().map_err(ApiError::bad_request)?;
    from.transition_to(to).map_err(ApiError::from)?;

    let updated = sqlx::query_as::<_, Deal>(
        r#"
        UPDATE deals SET status = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, status, title, amount_sats, currency, seller_pubkey, buyer_pubkey, mediator_pubkey,
                  settlement_model, network, escrow_address, funding_txid, funding_vout, funding_amount_sats,
                  settlement_txid, current_psbt, delivery_deadline, acceptance_window_hours, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(to.as_str())
    .fetch_one(&state.pool)
    .await?;

    append_event(
        &state.pool,
        id,
        EventKind::StatusTransitioned,
        EventPayload::StatusTransitioned { from, to },
        actor,
        None,
    )
    .await?;
    webhooks::enqueue_deal_event(state, "deal.transitioned", &updated).await?;
    return Ok(updated);
}

pub async fn prepare_funding(state: &AppState, id: &str, actor: &str) -> Result<Deal, ApiError> {
    let deal = get_deal(&state.pool, id).await?;
    assert_party(&deal, actor)?;
    let status = deal.status_enum().map_err(ApiError::bad_request)?;
    if status != DealStatus::Agreed && status != DealStatus::AwaitingPayment {
        return Err(ApiError::conflict_with_code(
            "deal must be agreed before funding prep",
            "illegal_transition",
        ));
    }

    let keys = EscrowKeys {
        buyer_pubkey: deal.buyer_pubkey.clone(),
        seller_pubkey: deal.seller_pubkey.clone(),
        mediator_pubkey: deal.mediator_pubkey.clone(),
    };
    let (escrow, info) = state
        .settlement
        .prepare_funding(&keys, &deal.network, deal.amount_sats as u64)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    let updated = sqlx::query_as::<_, Deal>(
        r#"
        UPDATE deals SET
            escrow_address = $2,
            escrow_script_pubkey_hex = $3,
            escrow_witness_script_hex = $4,
            status = $5,
            updated_at = now()
        WHERE id = $1
        RETURNING id, status, title, amount_sats, currency, seller_pubkey, buyer_pubkey, mediator_pubkey,
                  settlement_model, network, escrow_address, funding_txid, funding_vout, funding_amount_sats,
                  settlement_txid, current_psbt, delivery_deadline, acceptance_window_hours, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(&info.address)
    .bind(escrow.as_ref().map(|e| e.script_pubkey_hex.as_str()))
    .bind(escrow.as_ref().map(|e| e.witness_script_hex.as_str()))
    .bind(DealStatus::AwaitingPayment.as_str())
    .fetch_one(&state.pool)
    .await?;

    if status == DealStatus::Agreed {
        append_event(
            &state.pool,
            id,
            EventKind::StatusTransitioned,
            EventPayload::StatusTransitioned {
                from: DealStatus::Agreed,
                to: DealStatus::AwaitingPayment,
            },
            actor,
            None,
        )
        .await?;
    }
    return Ok(updated);
}

pub async fn load_escrow(pool: &PgPool, id: &str) -> Result<Option<EscrowDescriptor>, ApiError> {
    type EscrowRow = (Option<String>, Option<String>, Option<String>, String);
    let row: Option<EscrowRow> = sqlx::query_as(
        r#"
        SELECT escrow_address, escrow_script_pubkey_hex, escrow_witness_script_hex, network
        FROM deals WHERE id = $1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some((Some(address), Some(spk), Some(ws), network)) = row else {
        return Ok(None);
    };
    return Ok(Some(EscrowDescriptor {
        network,
        witness_script_hex: ws,
        script_pubkey_hex: spk,
        address,
        sorted_pubkeys: vec![],
    }));
}

pub async fn verify_funding(state: &AppState, id: &str, actor: &str) -> Result<Deal, ApiError> {
    let deal = get_deal(&state.pool, id).await?;
    assert_party(&deal, actor)?;
    let escrow = load_escrow(&state.pool, id).await?;
    let funding = opendeal_bitcoin::FundingInfo {
        address: deal.escrow_address.clone().unwrap_or_default(),
        script_pubkey_hex: escrow
            .as_ref()
            .map(|e| e.script_pubkey_hex.clone())
            .unwrap_or_default(),
        witness_script_hex: escrow
            .as_ref()
            .map(|e| e.witness_script_hex.clone())
            .unwrap_or_default(),
        expected_amount_sats: deal.amount_sats as u64,
        required_confirmations: state.config.bitcoin_required_confirmations,
        network: deal.network.clone(),
        settlement_model: parse_settlement_model(&deal.settlement_model),
    };

    let status = state
        .settlement
        .verify_funding(escrow.as_ref(), &funding, Some(id))
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    if let (Some(txid), Some(vout), Some(amount)) =
        (status.txid.clone(), status.vout, status.amount_sats)
    {
        append_event(
            &state.pool,
            id,
            EventKind::FundingDetected,
            EventPayload::FundingDetected {
                txid: txid.clone(),
                vout,
                amount_sats: amount,
            },
            actor,
            None,
        )
        .await?;

        sqlx::query(
            r#"
            UPDATE deals SET funding_txid = $2, funding_vout = $3, funding_amount_sats = $4, updated_at = now()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(&txid)
        .bind(vout as i32)
        .bind(amount as i64)
        .execute(&state.pool)
        .await?;

        if status.funded {
            append_event(
                &state.pool,
                id,
                EventKind::FundingConfirmed,
                EventPayload::FundingConfirmed {
                    txid,
                    vout,
                    confirmations: status.confirmations,
                },
                actor,
                None,
            )
            .await?;
            let current = deal.status_enum().map_err(ApiError::bad_request)?;
            if current == DealStatus::AwaitingPayment {
                return transition_deal(state, id, actor, DealStatus::Funded).await;
            }
        }
    }
    return get_deal(&state.pool, id).await;
}

pub async fn propose_settlement(
    state: &AppState,
    id: &str,
    actor: &str,
    destination: &str,
    fee_sats: u64,
    purpose_raw: &str,
) -> Result<Deal, ApiError> {
    let deal = get_deal(&state.pool, id).await?;
    assert_party(&deal, actor)?;
    let purpose = match purpose_raw {
        "refund_buyer" => SettlementPurpose::RefundBuyer,
        _ => SettlementPurpose::PayoutSeller,
    };
    let escrow = load_escrow(&state.pool, id)
        .await?
        .ok_or_else(|| ApiError::bad_request("escrow not prepared"))?;
    let txid = deal
        .funding_txid
        .clone()
        .ok_or_else(|| ApiError::bad_request("deal is not funded"))?;
    let vout = deal.funding_vout.unwrap_or(0) as u32;
    let amount = deal.funding_amount_sats.unwrap_or(deal.amount_sats) as u64;

    let psbt = state
        .settlement
        .propose_settlement(&escrow, &txid, vout, amount, destination, fee_sats, purpose)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    let updated = sqlx::query_as::<_, Deal>(
        r#"
        UPDATE deals SET current_psbt = $2, updated_at = now() WHERE id = $1
        RETURNING id, status, title, amount_sats, currency, seller_pubkey, buyer_pubkey, mediator_pubkey,
                  settlement_model, network, escrow_address, funding_txid, funding_vout, funding_amount_sats,
                  settlement_txid, current_psbt, delivery_deadline, acceptance_window_hours, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(&psbt.psbt_base64)
    .fetch_one(&state.pool)
    .await?;

    append_event(
        &state.pool,
        id,
        EventKind::SettlementProposed,
        EventPayload::SettlementProposed {
            psbt_base64: psbt.psbt_base64,
            purpose: purpose_raw.to_string(),
        },
        actor,
        None,
    )
    .await?;
    return Ok(updated);
}

pub async fn attach_psbt_signature(
    state: &AppState,
    id: &str,
    actor: &str,
    signed_psbt: &str,
) -> Result<Deal, ApiError> {
    let deal = get_deal(&state.pool, id).await?;
    assert_party(&deal, actor)?;
    let base = deal
        .current_psbt
        .clone()
        .ok_or_else(|| ApiError::bad_request("no settlement PSBT proposed"))?;
    let combined = state
        .settlement
        .attach_signature(&base, signed_psbt)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;
    let updated = sqlx::query_as::<_, Deal>(
        r#"
        UPDATE deals SET current_psbt = $2, updated_at = now() WHERE id = $1
        RETURNING id, status, title, amount_sats, currency, seller_pubkey, buyer_pubkey, mediator_pubkey,
                  settlement_model, network, escrow_address, funding_txid, funding_vout, funding_amount_sats,
                  settlement_txid, current_psbt, delivery_deadline, acceptance_window_hours, created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(&combined)
    .fetch_one(&state.pool)
    .await?;
    return Ok(updated);
}

pub async fn finalize_settlement(
    state: &AppState,
    id: &str,
    actor: &str,
) -> Result<Deal, ApiError> {
    let deal = get_deal(&state.pool, id).await?;
    assert_party(&deal, actor)?;
    let psbt = deal
        .current_psbt
        .clone()
        .ok_or_else(|| ApiError::bad_request("no settlement PSBT"))?;
    let txid = state
        .settlement
        .finalize_and_broadcast(&psbt)
        .await
        .map_err(|e| ApiError::bad_request(e.to_string()))?;

    sqlx::query("UPDATE deals SET settlement_txid = $2, updated_at = now() WHERE id = $1")
        .bind(id)
        .bind(&txid)
        .execute(&state.pool)
        .await?;

    append_event(
        &state.pool,
        id,
        EventKind::SettlementBroadcast,
        EventPayload::SettlementBroadcast { txid },
        actor,
        None,
    )
    .await?;

    let status = deal.status_enum().map_err(ApiError::bad_request)?;
    let next = if status == DealStatus::Disputed {
        // Mediator path may already have chosen; default to settled on successful broadcast from accepted/disputed.
        DealStatus::Settled
    } else {
        DealStatus::Settled
    };
    return transition_deal(state, id, actor, next).await;
}

pub async fn export_receipt(state: &AppState, id: &str) -> Result<DealReceipt, ApiError> {
    let deal = get_deal(&state.pool, id).await?;
    let agreement = load_agreement(&state.pool, id).await?;
    let events = list_events(&state.pool, id).await?;
    let sig_rows: Vec<(serde_json::Value,)> =
        sqlx::query_as("SELECT signature_json FROM agreement_signatures WHERE agreement_id = $1")
            .bind(id)
            .fetch_all(&state.pool)
            .await?;
    let mut agreement_signatures = Vec::new();
    for (v,) in sig_rows {
        agreement_signatures
            .push(serde_json::from_value(v).map_err(|e| ApiError::Internal(e.to_string()))?);
    }
    let receipt = DealReceipt {
        agreement,
        agreement_id: deal.id.clone(),
        status: deal.status_enum().map_err(ApiError::bad_request)?,
        settlement_model: parse_settlement_model(&deal.settlement_model),
        network: deal.network.clone(),
        agreement_signatures,
        events,
        funding_txid: deal.funding_txid,
        settlement_txid: deal.settlement_txid,
    };
    receipt.verify().map_err(ApiError::from)?;
    return Ok(receipt);
}
