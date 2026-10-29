use chrono::Utc;
use opendeal_core::{DealEvent, EventKind, EventPayload, Signature};
use sqlx::{PgConnection, PgPool};

use crate::error::ApiError;

pub async fn append_event_conn(
    connection: &mut PgConnection,
    agreement_id: &str,
    kind: EventKind,
    payload: EventPayload,
    actor_pubkey: &str,
    signature: Option<Signature>,
) -> Result<DealEvent, ApiError> {
    // Lock the parent even for the first event; locking only the previous event
    // cannot serialize empty chains or writers waiting on a stale last row.
    sqlx::query("SELECT id FROM deals WHERE id = $1 FOR UPDATE")
        .bind(agreement_id)
        .execute(&mut *connection)
        .await?;
    // Every event is a change to the deal. Bumping updated_at lets clients poll only
    // GET /deals/{id} and refetch details when it changes (agreement signatures and evidence
    // otherwise leave the deal row untouched).
    sqlx::query("UPDATE deals SET updated_at = now() WHERE id = $1")
        .bind(agreement_id)
        .execute(&mut *connection)
        .await?;
    let last = sqlx::query_as::<_, (i64, String)>(
        r#"
        SELECT sequence, event_hash FROM deal_events
        WHERE agreement_id = $1
        ORDER BY sequence DESC
        LIMIT 1
        FOR UPDATE
        "#,
    )
    .bind(agreement_id)
    .fetch_optional(&mut *connection)
    .await?;

    let (sequence, prev_hash) = match last {
        Some((seq, hash)) => ((seq + 1) as u64, hash),
        None => (0u64, String::new()),
    };

    let kind_str = serde_json::to_value(&kind)
        .ok()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| format!("{:?}", kind));

    let event = DealEvent {
        agreement_id: agreement_id.to_string(),
        sequence,
        kind,
        payload: payload.clone(),
        actor_pubkey: actor_pubkey.to_string(),
        prev_event_hash: prev_hash,
        created_at: chrono::DateTime::from_timestamp_micros(Utc::now().timestamp_micros())
            .expect("current timestamp"),
        signature: signature.clone(),
    };
    let event_hash = event
        .event_hash()
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    let payload_json =
        serde_json::to_value(&payload).map_err(|e| ApiError::Internal(e.to_string()))?;
    let sig_json = signature
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO deal_events
            (agreement_id, sequence, kind, payload, actor_pubkey, prev_event_hash, event_hash, signature_json, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
    )
    .bind(agreement_id)
    .bind(sequence as i64)
    .bind(&kind_str)
    .bind(&payload_json)
    .bind(actor_pubkey)
    .bind(&event.prev_event_hash)
    .bind(&event_hash)
    .bind(&sig_json)
    .bind(event.created_at)
    .execute(&mut *connection)
    .await?;

    return Ok(event);
}

pub async fn list_events(pool: &PgPool, agreement_id: &str) -> Result<Vec<DealEvent>, ApiError> {
    let mut connection = pool.acquire().await?;
    list_events_conn(&mut connection, agreement_id).await
}

pub async fn list_events_conn(
    connection: &mut PgConnection,
    agreement_id: &str,
) -> Result<Vec<DealEvent>, ApiError> {
    let rows = sqlx::query_as::<_, EventRow>(
        r#"
        SELECT agreement_id, sequence, kind, payload, actor_pubkey, prev_event_hash, event_hash, signature_json, created_at
        FROM deal_events
        WHERE agreement_id = $1
        ORDER BY sequence ASC
        "#,
    )
    .bind(agreement_id)
    .fetch_all(connection)
    .await?;

    let mut events = Vec::with_capacity(rows.len());
    for row in rows {
        let kind: EventKind = serde_json::from_value(serde_json::Value::String(row.kind.clone()))
            .or_else(|_| serde_json::from_str(&format!("\"{}\"", row.kind)))
            .map_err(|e| ApiError::Internal(format!("bad event kind: {}", e)))?;
        let payload: EventPayload =
            serde_json::from_value(row.payload).map_err(|e| ApiError::Internal(e.to_string()))?;
        let signature = row
            .signature_json
            .map(serde_json::from_value)
            .transpose()
            .map_err(|e| ApiError::Internal(e.to_string()))?;
        let event = DealEvent {
            agreement_id: row.agreement_id,
            sequence: row.sequence as u64,
            kind,
            payload,
            actor_pubkey: row.actor_pubkey,
            prev_event_hash: row.prev_event_hash,
            created_at: row.created_at,
            signature,
        };
        if event.event_hash().map_err(ApiError::from)? != row.event_hash {
            return Err(ApiError::Internal("stored event hash mismatch".into()));
        }
        events.push(event);
    }
    return Ok(events);
}

#[derive(sqlx::FromRow)]
struct EventRow {
    agreement_id: String,
    sequence: i64,
    kind: String,
    payload: serde_json::Value,
    actor_pubkey: String,
    prev_event_hash: String,
    event_hash: String,
    signature_json: Option<serde_json::Value>,
    created_at: chrono::DateTime<chrono::Utc>,
}
