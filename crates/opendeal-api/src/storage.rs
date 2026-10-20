use std::path::PathBuf;
use std::sync::Arc;

use aws_credential_types::Credentials;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::{BehaviorVersion, Region};
use aws_sdk_s3::primitives::ByteStream;
use sha2::{Digest, Sha256};
use tokio::fs;
use uuid::Uuid;

use crate::config::Config;
use crate::error::ApiError;

#[derive(Clone)]
pub struct ObjectStorage {
    inner: Arc<StorageInner>,
}

enum StorageInner {
    Local { root: PathBuf },
    R2 { client: Client, bucket: String },
}

impl ObjectStorage {
    pub async fn from_config(config: &Config) -> Result<Self, ApiError> {
        if config.r2_enabled() {
            let endpoint = config.r2_endpoint.clone().expect("r2 endpoint");
            let bucket = config.r2_bucket.clone().expect("r2 bucket");
            let access_key = config.r2_access_key_id.clone().expect("r2 access key");
            let secret_key = config.r2_secret_access_key.clone().expect("r2 secret");
            let credentials = Credentials::new(access_key, secret_key, None, None, "opendeal-r2");
            let s3_config = aws_sdk_s3::Config::builder()
                .behavior_version(BehaviorVersion::latest())
                .region(Region::new(config.r2_region.clone()))
                .endpoint_url(endpoint)
                .credentials_provider(credentials)
                .force_path_style(true)
                .build();
            let client = Client::from_conf(s3_config);
            return Ok(ObjectStorage {
                inner: Arc::new(StorageInner::R2 { client, bucket }),
            });
        }

        let root = config.evidence_dir.clone();
        fs::create_dir_all(&root)
            .await
            .map_err(|e| ApiError::Internal(format!("create evidence dir: {}", e)))?;
        return Ok(ObjectStorage {
            inner: Arc::new(StorageInner::Local { root }),
        });
    }

    pub async fn put_bytes(
        &self,
        agreement_id: &str,
        evidence_id: Uuid,
        bytes: &[u8],
        content_type: &str,
    ) -> Result<(String, String), ApiError> {
        let digest = hex::encode(Sha256::digest(bytes));
        let key = format!("{}/{}.bin", agreement_id, evidence_id);
        match self.inner.as_ref() {
            StorageInner::Local { root } => {
                let dir = root.join(agreement_id);
                fs::create_dir_all(&dir)
                    .await
                    .map_err(|e| ApiError::Internal(format!("evidence mkdir: {}", e)))?;
                let path = dir.join(format!("{}.bin", evidence_id));
                fs::write(&path, bytes)
                    .await
                    .map_err(|e| ApiError::Internal(format!("evidence write: {}", e)))?;
                let _ = content_type;
            }
            StorageInner::R2 { client, bucket } => {
                client
                    .put_object()
                    .bucket(bucket)
                    .key(&key)
                    .body(ByteStream::from(bytes.to_vec()))
                    .content_type(content_type)
                    .send()
                    .await
                    .map_err(|e| ApiError::Internal(format!("r2 put: {}", e)))?;
            }
        }
        return Ok((key, digest));
    }

    pub async fn get_bytes(&self, object_key: &str) -> Result<Vec<u8>, ApiError> {
        return match self.inner.as_ref() {
            StorageInner::Local { root } => {
                let path = root.join(object_key);
                fs::read(&path)
                    .await
                    .map_err(|e| ApiError::not_found(format!("evidence object missing: {}", e)))
            }
            StorageInner::R2 { client, bucket } => {
                let out = client
                    .get_object()
                    .bucket(bucket)
                    .key(object_key)
                    .send()
                    .await
                    .map_err(|e| ApiError::not_found(format!("r2 get: {}", e)))?;
                let bytes = out
                    .body
                    .collect()
                    .await
                    .map_err(|e| ApiError::Internal(format!("r2 body: {}", e)))?
                    .into_bytes()
                    .to_vec();
                return Ok(bytes);
            }
        };
    }
}
