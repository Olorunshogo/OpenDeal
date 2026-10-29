use crate::error::BitcoinError;

// Conservative P2WSH dust floor used by Bitcoin Core-style relay heuristics.
pub const DUST_RELAY_SATS: u64 = 330;
pub const MIN_DEAL_AMOUNT_SATS: u64 = 10_000;
pub const MIN_FEE_SATS: u64 = 200;
pub const MAX_FEE_SATS: u64 = 100_000;
// Fee may not exceed this fraction of funding (basis points). 2000 = 20%.
pub const MAX_FEE_BPS: u64 = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeeDustPolicy {
    pub dust_relay_sats: u64,
    pub min_deal_amount_sats: u64,
    pub min_fee_sats: u64,
    pub max_fee_sats: u64,
    pub max_fee_bps: u64,
}

impl Default for FeeDustPolicy {
    fn default() -> Self {
        return FeeDustPolicy {
            dust_relay_sats: DUST_RELAY_SATS,
            min_deal_amount_sats: MIN_DEAL_AMOUNT_SATS,
            min_fee_sats: MIN_FEE_SATS,
            max_fee_sats: MAX_FEE_SATS,
            max_fee_bps: MAX_FEE_BPS,
        };
    }
}

impl FeeDustPolicy {
    pub fn validate_deal_amount(&self, amount_sats: u64) -> Result<(), BitcoinError> {
        if amount_sats < self.min_deal_amount_sats {
            return Err(BitcoinError::Policy(format!(
                "deal amount {} sats is below minimum {}",
                amount_sats, self.min_deal_amount_sats
            )));
        }
        let min_viable = self.dust_relay_sats.saturating_add(self.min_fee_sats);
        if amount_sats < min_viable {
            return Err(BitcoinError::Policy(format!(
                "deal amount {} sats cannot cover dust {} plus min fee {}",
                amount_sats, self.dust_relay_sats, self.min_fee_sats
            )));
        }
        return Ok(());
    }

    pub fn validate_settlement_amounts(
        &self,
        funding_amount_sats: u64,
        fee_sats: u64,
    ) -> Result<u64, BitcoinError> {
        if fee_sats < self.min_fee_sats {
            return Err(BitcoinError::Policy(format!(
                "fee {} sats is below minimum {}",
                fee_sats, self.min_fee_sats
            )));
        }
        if fee_sats > self.max_fee_sats {
            return Err(BitcoinError::Policy(format!(
                "fee {} sats exceeds absolute maximum {}",
                fee_sats, self.max_fee_sats
            )));
        }
        if fee_sats >= funding_amount_sats {
            return Err(BitcoinError::Policy(format!(
                "fee {} sats must be less than funding {}",
                fee_sats, funding_amount_sats
            )));
        }
        let max_by_bps = funding_amount_sats.saturating_mul(self.max_fee_bps) / 10_000;
        if fee_sats > max_by_bps {
            return Err(BitcoinError::Policy(format!(
                "fee {} sats exceeds {} bps of funding {} (cap {})",
                fee_sats, self.max_fee_bps, funding_amount_sats, max_by_bps
            )));
        }
        let output_amount = funding_amount_sats - fee_sats;
        if output_amount < self.dust_relay_sats {
            return Err(BitcoinError::Policy(format!(
                "output {} sats is below dust relay floor {}",
                output_amount, self.dust_relay_sats
            )));
        }
        return Ok(output_amount);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_tiny_deal() {
        let policy = FeeDustPolicy::default();
        assert!(policy.validate_deal_amount(1_000).is_err());
        assert!(policy.validate_deal_amount(MIN_DEAL_AMOUNT_SATS).is_ok());
    }

    #[test]
    fn rejects_fee_below_floor() {
        let policy = FeeDustPolicy::default();
        assert!(policy.validate_settlement_amounts(50_000, 50).is_err());
    }

    #[test]
    fn rejects_fee_above_bps_cap() {
        let policy = FeeDustPolicy::default();
        // 20% of 50_000 = 10_000; 15_000 should fail bps even if under absolute max.
        assert!(policy.validate_settlement_amounts(50_000, 15_000).is_err());
    }

    #[test]
    fn rejects_dust_output() {
        let policy = FeeDustPolicy::default();
        // funding 600, fee 300 -> output 300 < dust 330
        assert!(policy.validate_settlement_amounts(600, 300).is_err());
    }

    #[test]
    fn accepts_sane_settlement() {
        let policy = FeeDustPolicy::default();
        let out = policy.validate_settlement_amounts(50_000, 500).unwrap();
        assert_eq!(out, 49_500);
    }
}
