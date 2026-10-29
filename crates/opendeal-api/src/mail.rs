use reqwest::Client;
use serde_json::json;

use crate::deals::models::Deal;
use crate::error::ApiError;
use crate::state::AppState;

pub async fn notify_deal_parties(
    state: &AppState,
    event: &str,
    deal: &Deal,
) -> Result<(), ApiError> {
    if !state.config.email_enabled() {
        return Ok(());
    }
    let emails = party_emails(state, deal).await?;
    if emails.is_empty() {
        return Ok(());
    }
    let from = state.config.email_from.clone().expect("email_from");
    let api_key = state.config.resend_api_key.clone().expect("resend key");
    let subject = format!("OpenDeal {} · {}", event, deal.title);
    let body = format!(
        "Deal {} is now \"{}\" ({} sats, {}).\nEvent: {}\n",
        deal.id, deal.status, deal.amount_sats, deal.network, event
    );
    let client = Client::new();
    for to in emails {
        let payload = json!({
            "from": from,
            "to": [to],
            "subject": subject,
            "text": body,
        });
        let result = client
            .post("https://api.resend.com/emails")
            .bearer_auth(&api_key)
            .json(&payload)
            .send()
            .await;
        match result {
            Ok(resp) if resp.status().is_success() => {}
            Ok(resp) => {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                tracing::warn!(%status, %text, "resend delivery failed");
            }
            Err(err) => {
                tracing::warn!(error = %err, "resend request failed");
            }
        }
    }
    return Ok(());
}

async fn party_emails(state: &AppState, deal: &Deal) -> Result<Vec<String>, ApiError> {
    let rows: Vec<(Option<String>,)> = sqlx::query_as(
        r#"
        SELECT email FROM users
        WHERE pubkey IN ($1, $2, $3) AND email IS NOT NULL
        "#,
    )
    .bind(&deal.seller_pubkey)
    .bind(&deal.buyer_pubkey)
    .bind(&deal.mediator_pubkey)
    .fetch_all(&state.pool)
    .await?;
    let mut emails = Vec::new();
    for (email,) in rows {
        if let Some(value) = email {
            if !value.is_empty() {
                emails.push(value);
            }
        }
    }
    return Ok(emails);
}
