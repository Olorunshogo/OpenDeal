//! Preserve the database's authoritative migration bytes while replaying its
//! historical dependency order. Do not replace this with filename-order CLI
//! replay: phase1_ops was introduced after backend_lifecycle was applied.
use crate::StartupError;
use serde::Serialize;
use sqlx::{PgPool, migrate::Migrator};

const INIT: i64 = 20261014000001;
const OPS: i64 = 20261014180000;
const LIFECYCLE: i64 = 20261022000002;
const AUTHORITATIVE: [(i64, &str); 3] = [
    (
        INIT,
        "ba8e5910ec94075271d47ffc1300a5ef658d2384036b0299ebbad8a85516dfe3056d1df6f13707654c7768f73f9790d1",
    ),
    (
        OPS,
        "fb86581662994512ae5adf583d898cb3df6137fce61aa2c3a5b083814c553a9c147b898d42a164b373eaac116a013d8a",
    ),
    (
        LIFECYCLE,
        "fbaf312be73712b950af6b550569ba32d2c12e4c966bdb41bda8ecf07e8ad2e8995e784126292c080bf24cb8b9293d16",
    ),
];

pub fn application_migrator() -> Result<Migrator, StartupError> {
    order_historical(sqlx::migrate!("./migrations"))
}

fn order_historical(mut migrator: Migrator) -> Result<Migrator, StartupError> {
    for (version, checksum) in AUTHORITATIVE {
        let migration = migrator
            .iter()
            .find(|m| m.version == version)
            .ok_or_else(|| StartupError(format!("authoritative migration {version} is missing")))?;
        if hex::encode(&migration.checksum) != checksum {
            return Err(StartupError(format!(
                "historical migration {version} differs from the audited applied bytes; do not rewrite database checksums or restore an unverified HEAD file"
            )));
        }
    }
    let migrations = migrator.migrations.to_mut();
    let ops = migrations.iter().position(|m| m.version == OPS).unwrap();
    let lifecycle = migrations
        .iter()
        .position(|m| m.version == LIFECYCLE)
        .unwrap();
    if ops < lifecycle {
        if lifecycle != ops + 1 {
            return Err(StartupError("historical migration dependency has an intervening migration; operator review required".into()));
        }
        migrations.swap(ops, lifecycle);
    }
    // SQLx retains its advisory lock, dirty-version checks, full checksum
    // validation, transactional apply and genuine history recording. Only the
    // two known historical migrations' execution order changes, never their SQL.
    Ok(migrator)
}

#[derive(Debug, Serialize)]
pub struct PendingMigration {
    pub version: i64,
    pub description: String,
    pub checksum_sha384: String,
}
#[derive(Debug, Serialize)]
pub struct MigrationPlan {
    pub database: String,
    pub role: String,
    pub applied_versions: Vec<i64>,
    pub pending: Vec<PendingMigration>,
}

/// A genuinely read-only preflight: does not create the SQLx ledger or apply SQL.
pub async fn migration_plan(pool: &PgPool) -> Result<MigrationPlan, StartupError> {
    let migrator = application_migrator()?;
    let mut tx = pool.begin().await.map_err(audit_error)?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await
        .map_err(audit_error)?;
    let (database, role, schema): (String, String, String) =
        sqlx::query_as("SELECT current_database(),current_user,current_schema()")
            .fetch_one(&mut *tx)
            .await
            .map_err(audit_error)?;
    if schema != "public" {
        return Err(StartupError(
            "migration preflight requires the public schema search path".into(),
        ));
    }
    let ledger: bool =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
            .fetch_one(&mut *tx)
            .await
            .map_err(audit_error)?;
    let rows: Vec<(i64, bool, Vec<u8>)> = if ledger {
        sqlx::query_as(
            "SELECT version,success,checksum FROM public._sqlx_migrations ORDER BY version",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(audit_error)?
    } else {
        vec![]
    };
    for (version, success, checksum) in &rows {
        if !success {
            return Err(StartupError(format!(
                "migration {version} is dirty; operator review required"
            )));
        }
        let expected = migrator
            .iter()
            .find(|m| m.version == *version)
            .ok_or_else(|| {
                StartupError(format!("applied migration {version} has no source file"))
            })?;
        if expected.checksum.as_ref() != checksum.as_slice() {
            return Err(StartupError(format!(
                "applied migration {version} checksum mismatch; no migrations were executed"
            )));
        }
    }
    let applied_versions: Vec<_> = rows.iter().map(|r| r.0).collect();
    if applied_versions.contains(&OPS) && !applied_versions.contains(&LIFECYCLE) {
        return Err(StartupError("phase1_ops is already applied without backend_lifecycle; this partial history requires separate schema review, not an automatic replay".into()));
    }
    if !applied_versions.contains(&INIT) {
        let existing:bool=sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename <> '_sqlx_migrations')").fetch_one(&mut *tx).await.map_err(audit_error)?;
        if existing || !applied_versions.is_empty() {
            return Err(StartupError(
                "existing schema lacks a verified initial migration; refusing bootstrap".into(),
            ));
        }
    }
    let pending = migrator
        .iter()
        .filter(|m| !m.migration_type.is_down_migration() && !applied_versions.contains(&m.version))
        .map(|m| PendingMigration {
            version: m.version,
            description: m.description.to_string(),
            checksum_sha384: hex::encode(&m.checksum),
        })
        .collect();
    tx.commit().await.map_err(audit_error)?;
    Ok(MigrationPlan {
        database,
        role,
        applied_versions,
        pending,
    })
}
fn audit_error(error: sqlx::Error) -> StartupError {
    StartupError(format!("migration preflight failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn historical_replay_preserves_bytes_and_reproduces_applied_dependency_order() {
        let original = sqlx::migrate!("./migrations");
        let ordered = application_migrator().unwrap();
        assert_eq!(
            ordered
                .iter()
                .take(3)
                .map(|m| m.version)
                .collect::<Vec<_>>(),
            vec![INIT, LIFECYCLE, OPS]
        );
        for migration in original.iter() {
            let replay = ordered
                .iter()
                .find(|m| m.version == migration.version)
                .unwrap();
            assert_eq!(migration.sql, replay.sql);
            assert_eq!(migration.checksum, replay.checksum);
        }
        assert!(ordered.locking && !ordered.ignore_missing && !ordered.no_tx);
    }
    #[test]
    fn unverified_historical_bytes_fail_closed() {
        let mut altered = sqlx::migrate!("./migrations");
        let migration = altered
            .migrations
            .to_mut()
            .iter_mut()
            .find(|m| m.version == LIFECYCLE)
            .unwrap();
        *migration = sqlx::migrate::Migration::new(
            migration.version,
            migration.description.clone(),
            migration.migration_type,
            migration
                .sql
                .replace(
                    "ADD COLUMN content_sha256",
                    "ADD COLUMN IF NOT EXISTS content_sha256",
                )
                .into(),
            migration.no_tx,
        );
        assert!(
            order_historical(altered)
                .unwrap_err()
                .to_string()
                .contains("audited applied bytes")
        );
    }
}
