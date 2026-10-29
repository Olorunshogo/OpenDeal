use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
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
    username: String,
    password: String,
    client: reqwest::Client,
}

impl HttpBitcoinRpc {
    pub fn new(
        url: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        Self {
            url: url.into(),
            username: username.into(),
            password: password.into(),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("valid RPC HTTP client configuration"),
        }
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
            .basic_auth(&self.username, Some(&self.password))
            .json(&body)
            .send()
            .await
            .map_err(|_| BitcoinError::Rpc("request failed (transport or timeout)".into()))?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(BitcoinError::Rpc("authentication failed (HTTP 401/403); check BITCOIN_RPC_USER and BITCOIN_RPC_PASSWORD".into()));
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| BitcoinError::Rpc("invalid JSON response".into()))?;
        if let Some(err) = value.get("error")
            && !err.is_null()
        {
            return Err(BitcoinError::RpcCode(
                err.get("code").and_then(Value::as_i64).unwrap_or(0),
            ));
        }
        if !status.is_success() {
            return Err(BitcoinError::Rpc(format!("HTTP {}", status.as_u16())));
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
        let amount_sats = rpc_sats(&result["value"])?;
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
                if let Some(info) = self.get_tx_out(&txid, vout).await? {
                    out.push(info);
                }
            }
        }
        return Ok(out);
    }

    async fn broadcast_hex(&self, tx_hex: &str) -> Result<String, BitcoinError> {
        let result = self.call("sendrawtransaction", json!([tx_hex])).await?;
        let txid = result
            .as_str()
            .ok_or_else(|| BitcoinError::Rpc("missing broadcast txid".into()))?;
        txid.parse::<bitcoin::Txid>()
            .map_err(|_| BitcoinError::Rpc("invalid broadcast txid".into()))?;
        return Ok(txid.to_owned());
    }

    async fn get_block_count(&self) -> Result<u64, BitcoinError> {
        let result = self.call("getblockcount", json!([])).await?;
        return result.as_u64().ok_or_else(|| {
            BitcoinError::Rpc("getblockcount returned an invalid block height".into())
        });
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
    transactions: Mutex<HashMap<String, TransactionStatus>>,
}

impl MockBitcoinRpc {
    pub fn new() -> Self {
        return Self::default();
    }

    pub fn set_transaction_status(&self, txid: &str, status: TransactionStatus) {
        self.transactions
            .lock()
            .expect("mock transaction mutex")
            .insert(txid.to_owned(), status);
    }

    pub fn broadcast_count(&self) -> usize {
        self.broadcasts.lock().expect("mock broadcast mutex").len()
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
        if let Ok(tx) = bitcoin::consensus::encode::deserialize_hex::<bitcoin::Transaction>(tx_hex)
        {
            let txid = tx.compute_txid().to_string();
            let mut utxos = self.utxos.lock().expect("mock utxo mutex");
            for input in &tx.input {
                utxos.remove(&(
                    input.previous_output.txid.to_string(),
                    input.previous_output.vout,
                ));
            }
            for (vout, output) in tx.output.iter().enumerate() {
                utxos.insert(
                    (txid.clone(), vout as u32),
                    UtxoInfo {
                        txid: txid.clone(),
                        vout: vout as u32,
                        amount_sats: output.value.to_sat(),
                        confirmations: 0,
                        script_pubkey_hex: hex::encode(output.script_pubkey.as_bytes()),
                    },
                );
            }
            self.set_transaction_status(
                &txid,
                TransactionStatus {
                    found: true,
                    confirmations: 0,
                    block_hash: None,
                },
            );
            return Ok(txid);
        }
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

fn rpc_sats(value: &Value) -> Result<u64, BitcoinError> {
    bitcoin::Amount::from_str_in(&value.to_string(), bitcoin::Denomination::Bitcoin)
        .map(|amount| amount.to_sat())
        .map_err(|_| BitcoinError::Rpc("invalid BTC amount in RPC response".into()))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TransactionStatus {
    pub found: bool,
    pub confirmations: u32,
    pub block_hash: Option<String>,
}

/// Read-only chain observations, separate from the existing BitcoinRpc contract.
#[async_trait]
pub trait BitcoinChain: BitcoinRpc {
    async fn check_network(&self, expected: &str) -> Result<(), BitcoinError>;
    async fn transaction_status(
        &self,
        txid: &str,
        block_hash: Option<&str>,
    ) -> Result<TransactionStatus, BitcoinError>;
}

#[async_trait]
impl BitcoinChain for HttpBitcoinRpc {
    async fn check_network(&self, expected: &str) -> Result<(), BitcoinError> {
        let info = self.call("getblockchaininfo", json!([])).await?;
        let actual = info["chain"]
            .as_str()
            .ok_or_else(|| BitcoinError::Rpc("missing chain".into()))?;
        let expected = crate::escrow::parse_network(expected)?;
        let actual_network = crate::escrow::parse_network(actual)?;
        if expected != actual_network {
            return Err(BitcoinError::NetworkMismatch {
                expected: expected.to_string(),
                got: actual.into(),
            });
        }
        Ok(())
    }

    async fn transaction_status(
        &self,
        txid: &str,
        block_hash: Option<&str>,
    ) -> Result<TransactionStatus, BitcoinError> {
        txid.parse::<bitcoin::Txid>()
            .map_err(|_| BitcoinError::Rpc("invalid txid".into()))?;
        if let Some(hash) = block_hash {
            hash.parse::<bitcoin::BlockHash>()
                .map_err(|_| BitcoinError::Rpc("invalid block hash".into()))?;
        }
        let params = match block_hash {
            Some(hash) => json!([txid, true, hash]),
            None => json!([txid, true]),
        };
        let result = match self.call("getrawtransaction", params).await {
            Ok(value) => value,
            Err(BitcoinError::RpcCode(-5 | -8)) => return Ok(TransactionStatus::default()),
            Err(error) => return Err(error),
        };
        if result["txid"].as_str() != Some(txid) {
            return Err(BitcoinError::Rpc("transaction lookup mismatch".into()));
        }
        if result["in_active_chain"].as_bool() == Some(false) {
            return Ok(TransactionStatus {
                found: true,
                ..Default::default()
            });
        }
        let mut confirmations = result["confirmations"].as_u64().unwrap_or(0);
        let block = result["blockhash"].as_str();
        if let Some(block) = block {
            let header = self.call("getblockheader", json!([block])).await?;
            confirmations = header["confirmations"].as_i64().unwrap_or(0).max(0) as u64;
        }
        Ok(TransactionStatus {
            found: true,
            confirmations: confirmations
                .try_into()
                .map_err(|_| BitcoinError::Rpc("confirmation overflow".into()))?,
            block_hash: block.filter(|_| confirmations > 0).map(str::to_owned),
        })
    }
}

#[async_trait]
impl BitcoinChain for MockBitcoinRpc {
    async fn check_network(&self, expected: &str) -> Result<(), BitcoinError> {
        if expected != "regtest" {
            return Err(BitcoinError::NetworkMismatch {
                expected: expected.into(),
                got: "regtest".into(),
            });
        }
        Ok(())
    }
    async fn transaction_status(
        &self,
        txid: &str,
        _block_hash: Option<&str>,
    ) -> Result<TransactionStatus, BitcoinError> {
        Ok(self
            .transactions
            .lock()
            .expect("mock transaction mutex")
            .get(txid)
            .cloned()
            .unwrap_or_default())
    }
}
