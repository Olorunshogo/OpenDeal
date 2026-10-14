//! Bitcoin settlement adapter for OpenDeal.
//!
//! The API coordinates funding verification and PSBT assembly. Private keys and seed phrases
//! never enter this crate's RPC client paths used by `opendeal-api`.

#![allow(clippy::needless_return, clippy::uninlined_format_args)]

pub mod error;
pub mod escrow;
pub mod psbt;
pub mod rpc;
pub mod settlement;

pub use error::BitcoinError;
pub use escrow::{EscrowDescriptor, EscrowKeys};
pub use psbt::{SettlementPsbt, SettlementPurpose};
pub use rpc::{BitcoinRpc, HttpBitcoinRpc, MockBitcoinRpc};
pub use settlement::{BitcoinMultisigAdapter, FundingInfo, FundingStatus};
