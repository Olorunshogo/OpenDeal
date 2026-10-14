use serde::{Deserialize, Serialize};

/**
 * Honest label for how funds move. UI and receipts must surface this. Never imply trustless
 * multisig when the path is a Lightning provider or a simulated adapter.
 */
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SettlementModel {
    /// Native SegWit P2WSH 2-of-3; API never holds spending keys.
    #[serde(rename = "bitcoin_multisig_2of3")]
    BitcoinMultisig2of3,
    /// Provider-mediated Lightning (custodial or wallet-connected). Custody differs by provider.
    LightningProvider,
    /// Fiat rail (Paystack/Flutterwave/etc.). Clearly custodial relative to OpenDeal.
    FiatProvider,
    /// Dev/demo only. Reports funding without moving value.
    Simulated,
}

impl SettlementModel {
    pub fn as_str(self) -> &'static str {
        return match self {
            SettlementModel::BitcoinMultisig2of3 => "bitcoin_multisig_2of3",
            SettlementModel::LightningProvider => "lightning_provider",
            SettlementModel::FiatProvider => "fiat_provider",
            SettlementModel::Simulated => "simulated",
        };
    }

    /// True when the coordination API cannot unilaterally move funds.
    pub fn api_cannot_spend(self) -> bool {
        return matches!(self, SettlementModel::BitcoinMultisig2of3);
    }
}

impl std::fmt::Display for SettlementModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        return write!(f, "{}", self.as_str());
    }
}
