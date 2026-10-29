use opendeal_bitcoin::{BitcoinRpc, HttpBitcoinRpc};

/// Read-only live test. Export all three variables explicitly; .env is not loaded.
#[tokio::test]
async fn bitcoin_core_getblockcount() {
    let names = [
        "BITCOIN_RPC_URL",
        "BITCOIN_RPC_USER",
        "BITCOIN_RPC_PASSWORD",
    ];
    let values: Vec<_> = names.iter().map(std::env::var).collect();
    if values
        .iter()
        .any(|value| value.as_ref().map_or(true, |value| value.trim().is_empty()))
    {
        eprintln!(
            "SKIPPED live Bitcoin RPC: export BITCOIN_RPC_URL, BITCOIN_RPC_USER and BITCOIN_RPC_PASSWORD"
        );
        return;
    }
    let rpc = HttpBitcoinRpc::new(
        values[0].as_ref().unwrap(),
        values[1].as_ref().unwrap(),
        values[2].as_ref().unwrap(),
    );
    // The client requires a nonnegative JSON integer; zero is valid on a fresh chain.
    let height = rpc
        .get_block_count()
        .await
        .expect("Bitcoin Core connectivity failed");
    eprintln!("Bitcoin Core getblockcount succeeded: height {height}");
}
