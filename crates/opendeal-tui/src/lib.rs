//! OpenDeal terminal UI for preparing demo data.
//!
//! The TUI is a preparation utility. It handles **public data only** (public keys, addresses,
//! deal terms) and reuses `opendeal-core` / `opendeal-bitcoin` for key normalization, escrow
//! derivation and amount policy. It never holds private keys, sessions or API secrets, and
//! never creates, signs, funds or settles deals. Those steps stay in the frontend.

#![allow(clippy::needless_return, clippy::uninlined_format_args)]

pub mod api;
pub mod app;
pub mod clipboard;
pub mod escrow;
pub mod export;
pub mod identity;
pub mod prepared;
pub mod recovery;
pub mod ui;
