//! Versioned prepared-deal configuration (schema v1) exchanged with the frontend.
//!
//! Field names follow the API's `CreateDealRequest`. The file holds public data only, and the
//! frontend and backend validate it again. It is never treated as trusted.
//! Documented in `docs/tui.md`.

use bitcoin::address::NetworkUnchecked;
use chrono::{DateTime, Duration, SubsecRound, Utc};
use opendeal_bitcoin::FeeDustPolicy;
use opendeal_bitcoin::escrow::parse_network;
use serde::{Deserialize, Serialize};

use crate::escrow::{SCRIPT_TYPE, derive_escrow};
use crate::identity::{PublicIdentity, check_distinct, parse_public_key};

pub const SCHEMA_VERSION: u32 = 1;
pub const KIND: &str = "opendeal.prepared_deal";
pub const SETTLEMENT_MODEL: &str = "bitcoin_multisig_2of3";
pub const MAX_FILE_BYTES: usize = 16 * 1024;
// Backend limits from `deals::service::create_deal`.
pub const MAX_TITLE_BYTES: usize = 256;
pub const MAX_DESCRIPTION_BYTES: usize = 10_000;
pub const MAX_AMOUNT_SATS: u64 = 2_100_000_000_000_000;
pub const MAX_ACCEPTANCE_HOURS: u32 = 8_760;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedDeal {
    pub schema_version: u32,
    pub kind: String,
    pub generated_at: DateTime<Utc>,
    pub generator: String,
    pub network: String,
    pub settlement_model: String,
    pub deal: PreparedTerms,
    pub participants: PreparedParticipants,
    pub escrow_preview: EscrowPreview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedTerms {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub amount_sats: u64,
    pub currency: String,
    pub delivery_deadline: DateTime<Utc>,
    pub acceptance_window_hours: u32,
    pub seller_payout_address: String,
    pub buyer_refund_address: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedParticipants {
    pub seller_pubkey: String,
    pub buyer_pubkey: String,
    pub mediator_pubkey: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mediator_display_name: Option<String>,
}

/// Derived address only. Funding is never checked or implied by this file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EscrowPreview {
    pub address: String,
    pub script_type: String,
    pub witness_script_hex: String,
    pub script_pubkey_hex: String,
    pub sorted_pubkeys: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    Title,
    Description,
    Amount,
    Deadline,
    Acceptance,
    Payout,
    Refund,
}

impl Field {
    pub const ALL: [Field; 7] = [
        Field::Title,
        Field::Description,
        Field::Amount,
        Field::Deadline,
        Field::Acceptance,
        Field::Payout,
        Field::Refund,
    ];

    pub fn label(self) -> &'static str {
        return match self {
            Field::Title => "Title",
            Field::Description => "Description (optional)",
            Field::Amount => "Amount (sats)",
            Field::Deadline => "Delivery deadline",
            Field::Acceptance => "Acceptance window (hours)",
            Field::Payout => "Seller payout address",
            Field::Refund => "Buyer refund address",
        };
    }

    pub fn hint(self) -> &'static str {
        return match self {
            Field::Title => "1-256 bytes",
            Field::Description => "up to 10,000 bytes",
            Field::Amount => "at least 10,000 sats",
            Field::Deadline => "e.g. 3d, 72h, or 2026-12-01T00:00:00Z",
            Field::Acceptance => "1-8760",
            Field::Payout => "address on the API network",
            Field::Refund => "address on the API network",
        };
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    pub field: Option<Field>,
    pub message: String,
}

impl Issue {
    fn field(field: Field, message: impl Into<String>) -> Self {
        return Issue {
            field: Some(field),
            message: message.into(),
        };
    }
    fn general(message: impl Into<String>) -> Self {
        return Issue {
            field: None,
            message: message.into(),
        };
    }
}

/// What the TUI knows about the server it is preparing for.
#[derive(Debug, Clone)]
pub struct ValidationContext {
    pub network: String,
    pub pilot_max_amount_sats: Option<u64>,
    pub now: DateTime<Utc>,
}

/// Editable form values (raw strings).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DealDraft {
    pub title: String,
    pub description: String,
    pub amount_sats: String,
    pub deadline: String,
    pub acceptance_hours: String,
    pub payout: String,
    pub refund: String,
}

impl Default for DealDraft {
    /// Defaults mirror the frontend's new-deal form (3-day deadline, 48h acceptance).
    fn default() -> Self {
        return DealDraft {
            title: "Used laptop".into(),
            description: String::new(),
            amount_sats: "50000".into(),
            deadline: "3d".into(),
            acceptance_hours: "48".into(),
            payout: String::new(),
            refund: String::new(),
        };
    }
}

impl DealDraft {
    pub fn get(&self, field: Field) -> &str {
        return match field {
            Field::Title => &self.title,
            Field::Description => &self.description,
            Field::Amount => &self.amount_sats,
            Field::Deadline => &self.deadline,
            Field::Acceptance => &self.acceptance_hours,
            Field::Payout => &self.payout,
            Field::Refund => &self.refund,
        };
    }

    pub fn set(&mut self, field: Field, value: String) {
        let slot = match field {
            Field::Title => &mut self.title,
            Field::Description => &mut self.description,
            Field::Amount => &mut self.amount_sats,
            Field::Deadline => &mut self.deadline,
            Field::Acceptance => &mut self.acceptance_hours,
            Field::Payout => &mut self.payout,
            Field::Refund => &mut self.refund,
        };
        *slot = value;
    }

    /// Parses the draft into typed terms, collecting every problem.
    pub fn to_terms(&self, ctx: &ValidationContext) -> Result<PreparedTerms, Vec<Issue>> {
        let mut issues = Vec::new();
        let amount = match self.amount_sats.trim().replace('_', "").parse::<u64>() {
            Ok(v) => Some(v),
            Err(_) => {
                issues.push(Issue::field(Field::Amount, "Enter a whole number of sats."));
                None
            }
        };
        let deadline = match parse_deadline(&self.deadline, ctx.now) {
            Ok(v) => Some(v),
            Err(e) => {
                issues.push(Issue::field(Field::Deadline, e));
                None
            }
        };
        let acceptance = match self.acceptance_hours.trim().parse::<u32>() {
            Ok(v) => Some(v),
            Err(_) => {
                issues.push(Issue::field(
                    Field::Acceptance,
                    "Enter whole hours (1-8760).",
                ));
                None
            }
        };
        let description = Some(self.description.trim().to_string()).filter(|d| !d.is_empty());
        if let (Some(amount_sats), Some(delivery_deadline), Some(acceptance_window_hours)) =
            (amount, deadline, acceptance)
        {
            let terms = PreparedTerms {
                title: self.title.trim().to_string(),
                description,
                amount_sats,
                currency: "BTC".into(),
                delivery_deadline,
                acceptance_window_hours,
                seller_payout_address: self.payout.trim().to_string(),
                buyer_refund_address: self.refund.trim().to_string(),
            };
            issues.extend(validate_terms(&terms, ctx));
            if issues.is_empty() {
                return Ok(terms);
            }
        } else {
            // Still report problems in the other fields.
            let partial = PreparedTerms {
                title: self.title.trim().to_string(),
                description,
                amount_sats: amount.unwrap_or(MIN_PLACEHOLDER),
                currency: "BTC".into(),
                delivery_deadline: deadline.unwrap_or(ctx.now + Duration::days(1)),
                acceptance_window_hours: acceptance.unwrap_or(1),
                seller_payout_address: self.payout.trim().to_string(),
                buyer_refund_address: self.refund.trim().to_string(),
            };
            issues.extend(validate_terms(&partial, ctx));
        }
        return Err(issues);
    }
}

const MIN_PLACEHOLDER: u64 = opendeal_bitcoin::policy::MIN_DEAL_AMOUNT_SATS;

/// Accepts `3d`, `72h`, or an RFC 3339 timestamp. Must be in the future.
pub fn parse_deadline(raw: &str, now: DateTime<Utc>) -> Result<DateTime<Utc>, String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err("Enter a deadline such as 3d, 72h, or 2026-12-01T00:00:00Z.".into());
    }
    let relative = |digits: &str, unit_hours: i64| -> Result<DateTime<Utc>, String> {
        let n: i64 = digits
            .parse()
            .map_err(|_| "Use a whole number before d or h.".to_string())?;
        let hours = n.saturating_mul(unit_hours);
        if hours <= 0 || hours > 24 * 365 {
            return Err("Relative deadline must be between 1h and 365d.".into());
        }
        return Ok((now + Duration::hours(hours)).trunc_subsecs(0));
    };
    let deadline = if let Some(d) = value.strip_suffix('d') {
        relative(d, 24)?
    } else if let Some(h) = value.strip_suffix('h') {
        relative(h, 1)?
    } else {
        DateTime::parse_from_rfc3339(value)
            .map_err(|_| "Use 3d, 72h, or RFC 3339 like 2026-12-01T00:00:00Z.".to_string())?
            .with_timezone(&Utc)
    };
    if deadline <= now {
        return Err("Deadline must be in the future.".into());
    }
    return Ok(deadline);
}

/// Mirrors the checks in the API's `create_deal`.
pub fn validate_terms(terms: &PreparedTerms, ctx: &ValidationContext) -> Vec<Issue> {
    let mut issues = Vec::new();
    if terms.title.trim().is_empty() {
        issues.push(Issue::field(Field::Title, "Title is required."));
    } else if terms.title.len() > MAX_TITLE_BYTES {
        issues.push(Issue::field(
            Field::Title,
            "Title must be at most 256 bytes.",
        ));
    } else if terms.title != terms.title.trim() {
        issues.push(Issue::field(
            Field::Title,
            "Remove leading/trailing spaces.",
        ));
    }
    if terms
        .description
        .as_ref()
        .is_some_and(|d| d.len() > MAX_DESCRIPTION_BYTES)
    {
        issues.push(Issue::field(
            Field::Description,
            "Description must be at most 10,000 bytes.",
        ));
    }
    if let Err(e) = FeeDustPolicy::default().validate_deal_amount(terms.amount_sats) {
        issues.push(Issue::field(Field::Amount, e.to_string()));
    } else if terms.amount_sats > MAX_AMOUNT_SATS {
        issues.push(Issue::field(Field::Amount, "Amount exceeds 21M BTC."));
    } else if ctx
        .pilot_max_amount_sats
        .is_some_and(|max| terms.amount_sats > max)
    {
        issues.push(Issue::field(
            Field::Amount,
            format!(
                "Amount exceeds the server pilot cap of {} sats.",
                ctx.pilot_max_amount_sats.unwrap_or_default()
            ),
        ));
    }
    if terms.currency != "BTC" {
        issues.push(Issue::general("Currency must be BTC."));
    }
    if terms.delivery_deadline <= ctx.now {
        issues.push(Issue::field(
            Field::Deadline,
            "Deadline must be in the future.",
        ));
    }
    if terms.acceptance_window_hours == 0 || terms.acceptance_window_hours > MAX_ACCEPTANCE_HOURS {
        issues.push(Issue::field(
            Field::Acceptance,
            "Acceptance window must be 1-8760 hours.",
        ));
    }
    for (field, address) in [
        (Field::Payout, &terms.seller_payout_address),
        (Field::Refund, &terms.buyer_refund_address),
    ] {
        if let Err(e) = validate_address(address, &ctx.network) {
            issues.push(Issue::field(field, e));
        }
    }
    return issues;
}

/// Same check as the API: parse, then require the configured network.
pub fn validate_address(address: &str, network_name: &str) -> Result<(), String> {
    if address.trim().is_empty() {
        return Err(
            "Address is required (both destinations are signed into the agreement).".into(),
        );
    }
    let network = parse_network(network_name).map_err(|e| e.to_string())?;
    address
        .trim()
        .parse::<bitcoin::Address<NetworkUnchecked>>()
        .map_err(|_| "Not a valid Bitcoin address.".to_string())?
        .require_network(network)
        .map_err(|_| format!("Address is not valid on {}.", network_name))?;
    return Ok(());
}

impl PreparedDeal {
    /// Builds a validated configuration. Escrow is derived by `opendeal-bitcoin`.
    pub fn build(
        terms: PreparedTerms,
        seller: &PublicIdentity,
        buyer: &PublicIdentity,
        mediator: &PublicIdentity,
        mediator_display_name: Option<String>,
        ctx: &ValidationContext,
    ) -> Result<PreparedDeal, Vec<Issue>> {
        check_distinct(&[seller, buyer, mediator]).map_err(|e| vec![Issue::general(e)])?;
        let escrow = derive_escrow(&buyer.xonly, &seller.xonly, &mediator.xonly, &ctx.network)
            .map_err(|e| vec![Issue::general(format!("Escrow derivation failed: {}", e))])?;
        let prepared = PreparedDeal {
            schema_version: SCHEMA_VERSION,
            kind: KIND.into(),
            generated_at: ctx.now.trunc_subsecs(0),
            generator: format!("opendeal-tui {}", env!("CARGO_PKG_VERSION")),
            network: ctx.network.clone(),
            settlement_model: SETTLEMENT_MODEL.into(),
            deal: terms,
            participants: PreparedParticipants {
                seller_pubkey: seller.xonly.clone(),
                buyer_pubkey: buyer.xonly.clone(),
                mediator_pubkey: mediator.xonly.clone(),
                mediator_display_name,
            },
            escrow_preview: EscrowPreview {
                address: escrow.address,
                script_type: SCRIPT_TYPE.into(),
                witness_script_hex: escrow.witness_script_hex,
                script_pubkey_hex: escrow.script_pubkey_hex,
                sorted_pubkeys: escrow.sorted_pubkeys,
            },
        };
        prepared.validate(ctx)?;
        return Ok(prepared);
    }

    /// Full validation, including re-deriving the escrow preview.
    pub fn validate(&self, ctx: &ValidationContext) -> Result<(), Vec<Issue>> {
        let mut issues = Vec::new();
        if self.schema_version != SCHEMA_VERSION {
            issues.push(Issue::general(format!(
                "Unsupported schema_version {}.",
                self.schema_version
            )));
        }
        if self.kind != KIND {
            issues.push(Issue::general(format!("kind must be \"{}\".", KIND)));
        }
        if self.settlement_model != SETTLEMENT_MODEL {
            issues.push(Issue::general(
                "Only bitcoin_multisig_2of3 has an implemented settlement lifecycle.",
            ));
        }
        if self.network != ctx.network {
            issues.push(Issue::general(format!(
                "File is for {} but the server is on {}.",
                self.network, ctx.network
            )));
        }
        if let Some(name) = &self.participants.mediator_display_name
            && (name.len() > 80 || name.contains(['\n', '\r']))
        {
            issues.push(Issue::general("Mediator display name is malformed."));
        }
        issues.extend(validate_terms(&self.deal, ctx));
        let keys: Vec<Result<String, String>> = [
            &self.participants.seller_pubkey,
            &self.participants.buyer_pubkey,
            &self.participants.mediator_pubkey,
        ]
        .iter()
        .map(|k| parse_public_key(k))
        .collect();
        let mut normalized = Vec::new();
        for (role, (raw, key)) in ["seller", "buyer", "mediator"].iter().zip(
            [
                &self.participants.seller_pubkey,
                &self.participants.buyer_pubkey,
                &self.participants.mediator_pubkey,
            ]
            .iter()
            .zip(keys),
        ) {
            match key {
                Ok(k) if &&k == raw => normalized.push(k),
                Ok(_) => issues.push(Issue::general(format!(
                    "{} public key must be lowercase 32-byte x-only hex.",
                    role
                ))),
                Err(e) => issues.push(Issue::general(format!("{} public key: {}", role, e))),
            }
        }
        if normalized.len() == 3 {
            if normalized[0] == normalized[1]
                || normalized[0] == normalized[2]
                || normalized[1] == normalized[2]
            {
                issues.push(Issue::general("Participants must be three distinct keys."));
            } else {
                match derive_escrow(
                    &normalized[1],
                    &normalized[0],
                    &normalized[2],
                    &self.network,
                ) {
                    Ok(d) => {
                        let p = &self.escrow_preview;
                        if p.address != d.address
                            || p.witness_script_hex != d.witness_script_hex
                            || p.script_pubkey_hex != d.script_pubkey_hex
                            || p.sorted_pubkeys != d.sorted_pubkeys
                            || p.script_type != SCRIPT_TYPE
                        {
                            issues.push(Issue::general(
                                "Escrow preview does not match the participants' 2-of-3 script.",
                            ));
                        }
                    }
                    Err(e) => issues.push(Issue::general(format!("Escrow: {}", e))),
                }
            }
        }
        if issues.is_empty() {
            return Ok(());
        }
        return Err(issues);
    }

    pub fn to_json_pretty(&self) -> String {
        return serde_json::to_string_pretty(self).expect("prepared deal serializes");
    }

    /// Parses and fully validates a file. Unknown fields and other schema versions are rejected.
    pub fn from_json(text: &str, ctx: &ValidationContext) -> Result<PreparedDeal, Vec<Issue>> {
        if text.len() > MAX_FILE_BYTES {
            return Err(vec![Issue::general(
                "Prepared configuration file is too large.",
            )]);
        }
        let value: serde_json::Value = serde_json::from_str(text)
            .map_err(|_| vec![Issue::general("File is not valid JSON.")])?;
        match value.get("schema_version").and_then(|v| v.as_u64()) {
            Some(v) if v == SCHEMA_VERSION as u64 => {}
            Some(v) => {
                return Err(vec![Issue::general(format!(
                    "Unsupported schema_version {} (this tool supports {}).",
                    v, SCHEMA_VERSION
                ))]);
            }
            None => return Err(vec![Issue::general("Missing schema_version.")]),
        }
        let parsed: PreparedDeal = serde_json::from_value(value)
            .map_err(|e| vec![Issue::general(format!("Malformed configuration: {}", e))])?;
        parsed.validate(ctx)?;
        return Ok(parsed);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::identity::tests::test_pubkey_xonly;
    use crate::identity::{IdentitySource, Role};
    use bitcoin::secp256k1::{Secp256k1, SecretKey};
    use chrono::TimeZone;

    pub fn regtest_address(seed: u8) -> String {
        let secp = Secp256k1::new();
        let sk = SecretKey::from_slice(&[seed; 32]).unwrap();
        let pk = bitcoin::CompressedPublicKey::from_private_key(
            &secp,
            &bitcoin::PrivateKey::new(sk, bitcoin::Network::Regtest),
        )
        .unwrap();
        return bitcoin::Address::p2wpkh(&pk, bitcoin::Network::Regtest).to_string();
    }

    pub fn ctx() -> ValidationContext {
        return ValidationContext {
            network: "regtest".into(),
            pilot_max_amount_sats: None,
            now: Utc.with_ymd_and_hms(2026, 10, 28, 12, 0, 0).unwrap(),
        };
    }

    pub fn ids() -> (PublicIdentity, PublicIdentity, PublicIdentity) {
        let id = |role, seed| {
            PublicIdentity::new(role, &test_pubkey_xonly(seed), IdentitySource::Manual).unwrap()
        };
        return (
            id(Role::Seller, 1),
            id(Role::Buyer, 2),
            id(Role::Mediator, 3),
        );
    }

    pub fn draft() -> DealDraft {
        return DealDraft {
            payout: regtest_address(10),
            refund: regtest_address(11),
            ..DealDraft::default()
        };
    }

    pub fn sample() -> PreparedDeal {
        let (s, b, m) = ids();
        let terms = draft().to_terms(&ctx()).unwrap();
        return PreparedDeal::build(
            terms,
            &s,
            &b,
            &m,
            Some("Local demo mediator".into()),
            &ctx(),
        )
        .unwrap();
    }

    #[test]
    fn valid_draft_builds_and_round_trips() {
        let prepared = sample();
        assert_eq!(prepared.schema_version, 1);
        assert_eq!(prepared.deal.amount_sats, 50_000);
        assert_eq!(
            prepared.deal.delivery_deadline,
            Utc.with_ymd_and_hms(2026, 10, 31, 12, 0, 0).unwrap()
        );
        let json = prepared.to_json_pretty();
        let back = PreparedDeal::from_json(&json, &ctx()).unwrap();
        assert_eq!(back, prepared);
    }

    #[test]
    fn draft_validation_reports_each_field() {
        let bad = DealDraft {
            title: " ".into(),
            amount_sats: "500".into(),
            deadline: "yesterday".into(),
            acceptance_hours: "0".into(),
            payout: "not-an-address".into(),
            refund: String::new(),
            description: String::new(),
        };
        let issues = bad.to_terms(&ctx()).unwrap_err();
        for field in [
            Field::Title,
            Field::Amount,
            Field::Deadline,
            Field::Acceptance,
            Field::Payout,
            Field::Refund,
        ] {
            assert!(
                issues.iter().any(|i| i.field == Some(field)),
                "missing issue for {:?}: {:?}",
                field,
                issues
            );
        }
    }

    #[test]
    fn rejects_wrong_network_address_and_pilot_cap() {
        let mut d = draft();
        d.payout = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq".into();
        assert!(d.to_terms(&ctx()).is_err());
        let mut capped = ctx();
        capped.pilot_max_amount_sats = Some(20_000);
        assert!(draft().to_terms(&capped).is_err());
    }

    #[test]
    fn deadline_formats() {
        let now = ctx().now;
        assert_eq!(
            parse_deadline("72h", now).unwrap(),
            now + Duration::hours(72)
        );
        assert!(parse_deadline("2026-12-01T00:00:00Z", now).is_ok());
        assert!(parse_deadline("2020-01-01T00:00:00Z", now).is_err());
        assert!(parse_deadline("0d", now).is_err());
        assert!(parse_deadline("999d", now).is_err());
    }

    #[test]
    fn rejects_unsupported_schema_versions_and_unknown_fields() {
        let mut value = serde_json::to_value(sample()).unwrap();
        value["schema_version"] = serde_json::json!(2);
        let err = PreparedDeal::from_json(&value.to_string(), &ctx()).unwrap_err();
        assert!(err[0].message.contains("Unsupported schema_version 2"));

        let mut extra = serde_json::to_value(sample()).unwrap();
        extra["participants"]["seller_secret"] = serde_json::json!("deadbeef");
        assert!(PreparedDeal::from_json(&extra.to_string(), &ctx()).is_err());

        let mut top = serde_json::to_value(sample()).unwrap();
        top["jwt"] = serde_json::json!("eyJ...");
        assert!(PreparedDeal::from_json(&top.to_string(), &ctx()).is_err());

        assert!(PreparedDeal::from_json("{}", &ctx()).is_err());
        assert!(PreparedDeal::from_json("[", &ctx()).is_err());
    }

    #[test]
    fn rejects_tampered_escrow_network_and_keys() {
        let mut value = serde_json::to_value(sample()).unwrap();
        value["escrow_preview"]["address"] = serde_json::json!(
            crate::escrow::derive_escrow(
                &test_pubkey_xonly(5),
                &test_pubkey_xonly(1),
                &test_pubkey_xonly(3),
                "regtest"
            )
            .unwrap()
            .address
        );
        assert!(PreparedDeal::from_json(&value.to_string(), &ctx()).is_err());

        let mut testnet_ctx = ctx();
        testnet_ctx.network = "testnet".into();
        assert!(PreparedDeal::from_json(&sample().to_json_pretty(), &testnet_ctx).is_err());

        let mut dup = serde_json::to_value(sample()).unwrap();
        dup["participants"]["buyer_pubkey"] = dup["participants"]["seller_pubkey"].clone();
        assert!(PreparedDeal::from_json(&dup.to_string(), &ctx()).is_err());

        let mut model = serde_json::to_value(sample()).unwrap();
        model["settlement_model"] = serde_json::json!("simulated");
        assert!(PreparedDeal::from_json(&model.to_string(), &ctx()).is_err());
    }

    #[test]
    fn export_contains_no_secret_material() {
        let json = sample().to_json_pretty().to_ascii_lowercase();
        for forbidden in [
            "secret",
            "private",
            "seed",
            "passphrase",
            "mnemonic",
            "token",
            "jwt",
            "cookie",
            "password",
            "rpc",
            "ciphertext",
            "salt",
            "nsec",
            "xprv",
        ] {
            assert!(!json.contains(forbidden), "export mentions {}", forbidden);
        }
        // Only the expected top-level keys exist.
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        let mut keys: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "deal",
                "escrow_preview",
                "generated_at",
                "generator",
                "kind",
                "network",
                "participants",
                "schema_version",
                "settlement_model"
            ]
        );
    }

    #[test]
    fn fields_match_create_deal_request_names() {
        // The frontend maps these 1:1 onto POST /api/v1/deals.
        let value = serde_json::to_value(sample()).unwrap();
        for key in [
            "title",
            "amount_sats",
            "currency",
            "delivery_deadline",
            "acceptance_window_hours",
            "seller_payout_address",
            "buyer_refund_address",
        ] {
            assert!(value["deal"].get(key).is_some(), "missing deal.{}", key);
        }
        for key in ["seller_pubkey", "buyer_pubkey", "mediator_pubkey"] {
            assert!(value["participants"].get(key).is_some());
        }
    }
}
