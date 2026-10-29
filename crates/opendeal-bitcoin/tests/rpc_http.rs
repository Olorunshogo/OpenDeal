use base64::Engine;
use opendeal_bitcoin::{BitcoinRpc, HttpBitcoinRpc};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn serve_once(status: &str, body: &str) -> (String, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = [0; 1024];
        loop {
            let n = stream.read(&mut buffer).await.unwrap();
            assert!(n > 0);
            request.extend_from_slice(&buffer[..n]);
            if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]);
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")?
                            .parse()
                            .ok()
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(request).unwrap()
    });
    (url, task)
}

#[tokio::test]
async fn sends_basic_auth_and_accepts_genesis_height() {
    let (url, request) = serve_once("200 OK", r#"{"result":0,"error":null}"#).await;
    let rpc = HttpBitcoinRpc::new(url, "test-user", "test-password");
    assert_eq!(rpc.get_block_count().await.unwrap(), 0);
    let request = request.await.unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode("test-user:test-password");
    let header = request
        .lines()
        .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
        .unwrap();
    assert_eq!(
        header.split_once(':').unwrap().1.trim(),
        format!("Basic {encoded}")
    );
    assert!(request.contains("getblockcount"));
}

#[tokio::test]
async fn auth_failure_does_not_parse_or_expose_response_body() {
    let (url, request) = serve_once("401 Unauthorized", "test-password").await;
    let rpc = HttpBitcoinRpc::new(url, "test-user", "test-password");
    let error = rpc.get_block_count().await.unwrap_err().to_string();
    assert!(error.contains("authentication failed"));
    assert!(!error.contains("test-password"));
    request.await.unwrap();
}

#[tokio::test]
async fn rejects_invalid_height() {
    let (url, request) = serve_once("200 OK", r#"{"result":-1,"error":null}"#).await;
    let rpc = HttpBitcoinRpc::new(url, "test-user", "test-password");
    assert!(rpc.get_block_count().await.is_err());
    request.await.unwrap();
}
