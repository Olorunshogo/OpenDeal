use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::BitcoinError;

#[derive(Debug, Clone)]
pub struct UtxoInfo {
    pub txid: String,
    pub vout: u32,
    pub amount_sats: u64,
    pub confirmations: u32,
    pub script_pubkey_hex: String,
}

#[async_trait]
pub trait BitcoinRpc: Send + Sync {
    async fn get_tx_out(&self, txid: &str, vout: u32) -> Result<Option<UtxoInfo>, BitcoinError>;
    async fn scan_address_utxos(&self, address: &str) -> Result<Vec<UtxoInfo>, BitcoinError>;
    async fn broadcast_hex(&self, tx_hex: &str) -> Result<String, BitcoinError>;
    async fn get_block_count(&self) -> Result<u64, BitcoinError>;
}

/// Bitcoin Core JSON-RPC over HTTP. Never sends wallet private-key RPCs.
pub struct HttpBitcoinRpc {
    url: String,
    client: reqwest::Client,
}

impl HttpBitcoinRpc {
    pub fn new(url: impl Into<String>) -> Self {
        return HttpBitcoinRpc {
            url: url.into(),
            client: reqwest::Client::new(),
        };
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, BitcoinError> {
        let body = json!({
            "jsonrpc": "1.0",
            "id": "opendeal",
            "method": method,
            "params": params,
        });
        let response = self
            .client
            .post(&self.url)
            .json(&body)
            .send()
            .await
            .map_err(|e| BitcoinError::Rpc(e.to_string()))?;
        let status = response.status();
        let value: Value = response
            .json()
            .await
            .map_err(|e| BitcoinError::Rpc(e.to_string()))?;
        if !status.is_success() {
            return Err(BitcoinError::Rpc(format!("http {}: {}", status, value)));
        }
        if let Some(err) = value.get("error")
            && !err.is_null()
        {
            return Err(BitcoinError::Rpc(err.to_string()));
        }
        return Ok(value.get("result").cloned().unwrap_or(Value::Null));
    }
}

#[async_trait]
impl BitcoinRpc for HttpBitcoinRpc {
    async fn get_tx_out(&self, txid: &str, vout: u32) -> Result<Option<UtxoInfo>, BitcoinError> {
        let result = self.call("gettxout", json!([txid, vout, true])).await?;
        if result.is_null() {
            return Ok(None);
        }
        let confirmations = result["confirmations"].as_u64().unwrap_or(0) as u32;
        let amount_btc = result["value"].as_f64().unwrap_or(0.0);
        let amount_sats = (amount_btc * 100_000_000.0).round() as u64;
        let script_pubkey_hex = result["scriptPubKey"]["hex"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        return Ok(Some(UtxoInfo {
            txid: txid.to_string(),
            vout,
            amount_sats,
            confirmations,
            script_pubkey_hex,
        }));
    }

    async fn scan_address_utxos(&self, address: &str) -> Result<Vec<UtxoInfo>, BitcoinError> {
        // scantxoutset is slow but works without importing descriptors into a wallet.
        let result = self
            .call(
                "scantxoutset",
                json!(["start", [{"desc": format!("addr({})", address)}]]),
            )
            .await?;
        let mut out = Vec::new();
        if let Some(unspents) = result["unspents"].as_array() {
            for u in unspents {
                let txid = u["txid"].as_str().unwrap_or_default().to_string();
                let vout = u["vout"].as_u64().unwrap_or(0) as u32;
                let amount_btc = u["amount"].as_f64().unwrap_or(0.0);
                let amount_sats = (amount_btc * 100_000_000.0).round() as u64;
                let script_pubkey_hex = u["scriptPubKey"].as_str().unwrap_or_default().to_string();
                // scantxoutset does not return confirmations; treat found UTXOs as 1+ and let
                // get_tx_out refine when a specific outpoint is known.
                let confirmations = match self.get_tx_out(&txid, vout).await? {
                    Some(info) => info.confirmations,
                    None => 0,
                };
                out.push(UtxoInfo {
                    txid,
                    vout,
                    amount_sats,
                    confirmations,
                    script_pubkey_hex,
                });
            }
        }
        return Ok(out);
    }

    async fn broadcast_hex(&self, tx_hex: &str) -> Result<String, BitcoinError> {
        let result = self.call("sendrawtransaction", json!([tx_hex])).await?;
        return Ok(result.as_str().unwrap_or_default().to_string());
    }

    async fn get_block_count(&self) -> Result<u64, BitcoinError> {
        let result = self.call("getblockcount", json!([])).await?;
        return Ok(result.as_u64().unwrap_or(0));
    }
}

/// Tries `primary`, then `fallback` when the primary call returns an error.
pub struct RedundantBitcoinRpc {
    primary: Arc<dyn BitcoinRpc>,
    fallback: Arc<dyn BitcoinRpc>,
}

impl RedundantBitcoinRpc {
    pub fn new(primary: Arc<dyn BitcoinRpc>, fallback: Arc<dyn BitcoinRpc>) -> Self {
        return RedundantBitcoinRpc { primary, fallback };
    }
}

#[async_trait]
impl BitcoinRpc for RedundantBitcoinRpc {
    async fn get_tx_out(&self, txid: &str, vout: u32) -> Result<Option<UtxoInfo>, BitcoinError> {
        return match self.primary.get_tx_out(txid, vout).await {
            Ok(value) => Ok(value),
            Err(primary_err) => {
                tracing::warn!(error = %primary_err, "primary bitcoin rpc get_tx_out failed; trying fallback");
                self.fallback.get_tx_out(txid, vout).await
            }
        };
    }

    async fn scan_address_utxos(&self, address: &str) -> Result<Vec<UtxoInfo>, BitcoinError> {
        return match self.primary.scan_address_utxos(address).await {
            Ok(value) => Ok(value),
            Err(primary_err) => {
                tracing::warn!(error = %primary_err, "primary bitcoin rpc scan failed; trying fallback");
                self.fallback.scan_address_utxos(address).await
            }
        };
    }

    async fn broadcast_hex(&self, tx_hex: &str) -> Result<String, BitcoinError> {
        return match self.primary.broadcast_hex(tx_hex).await {
            Ok(value) => Ok(value),
            Err(primary_err) => {
                tracing::warn!(error = %primary_err, "primary bitcoin rpc broadcast failed; trying fallback");
                self.fallback.broadcast_hex(tx_hex).await
            }
        };
    }

    async fn get_block_count(&self) -> Result<u64, BitcoinError> {
        return match self.primary.get_block_count().await {
            Ok(value) => Ok(value),
            Err(primary_err) => {
                tracing::warn!(error = %primary_err, "primary bitcoin rpc get_block_count failed; trying fallback");
                self.fallback.get_block_count().await
            }
        };
    }
}

/// In-memory RPC for unit tests and Simulated-adjacent flows without bitcoind.
#[derive(Default)]
pub struct MockBitcoinRpc {
    utxos: Mutex<HashMap<(String, u32), UtxoInfo>>,
    broadcasts: Mutex<Vec<String>>,
}

impl MockBitcoinRpc {
    pub fn new() -> Self {
        return Self::default();
    }

    pub fn insert_utxo(&self, info: UtxoInfo) {
        let mut map = self.utxos.lock().expect("mock utxo mutex");
        map.insert((info.txid.clone(), info.vout), info);
    }
}

#[async_trait]
impl BitcoinRpc for MockBitcoinRpc {
    async fn get_tx_out(&self, txid: &str, vout: u32) -> Result<Option<UtxoInfo>, BitcoinError> {
        let map = self.utxos.lock().expect("mock utxo mutex");
        return Ok(map.get(&(txid.to_string(), vout)).cloned());
    }

    async fn scan_address_utxos(&self, _address: &str) -> Result<Vec<UtxoInfo>, BitcoinError> {
        let map = self.utxos.lock().expect("mock utxo mutex");
        return Ok(map.values().cloned().collect());
    }

    async fn broadcast_hex(&self, tx_hex: &str) -> Result<String, BitcoinError> {
        self.broadcasts
            .lock()
            .expect("broadcast mutex")
            .push(tx_hex.to_string());
        // Deterministic fake txid from content length. Tests only.
        return Ok(format!("{:064x}", tx_hex.len()));
    }

    async fn get_block_count(&self) -> Result<u64, BitcoinError> {
        return Ok(100);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FailingRpc;

    #[async_trait]
    impl BitcoinRpc for FailingRpc {
        async fn get_tx_out(&self, _: &str, _: u32) -> Result<Option<UtxoInfo>, BitcoinError> {
            return Err(BitcoinError::Rpc("primary down".into()));
        }
        async fn scan_address_utxos(&self, _: &str) -> Result<Vec<UtxoInfo>, BitcoinError> {
            return Err(BitcoinError::Rpc("primary down".into()));
        }
        async fn broadcast_hex(&self, _: &str) -> Result<String, BitcoinError> {
            return Err(BitcoinError::Rpc("primary down".into()));
        }
        async fn get_block_count(&self) -> Result<u64, BitcoinError> {
            return Err(BitcoinError::Rpc("primary down".into()));
        }
    }

    #[tokio::test]
    async fn fallback_rpc_used_when_primary_fails() {
        let fallback = Arc::new(MockBitcoinRpc::new());
        fallback.insert_utxo(UtxoInfo {
            txid: "ab".repeat(32),
            vout: 1,
            amount_sats: 10_000,
            confirmations: 3,
            script_pubkey_hex: "0014".into(),
        });
        let rpc = RedundantBitcoinRpc::new(Arc::new(FailingRpc), fallback);
        let info = rpc.get_tx_out(&"ab".repeat(32), 1).await.unwrap().unwrap();
        assert_eq!(info.amount_sats, 10_000);
        assert_eq!(rpc.get_block_count().await.unwrap(), 100);
    }
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct RpcEnvelope {
    result: Option<Value>,
    error: Option<Value>,
}
