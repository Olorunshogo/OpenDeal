use super::*;

async fn ledger(pool: &sqlx::PgPool) -> Value {
    sqlx::query_scalar("SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY version),'[]'::jsonb) FROM _sqlx_migrations m").fetch_one(pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires OPENDEAL_TEST_ADMIN_URL; fresh disposable database, no Bitcoin"]
async fn complete_authoritative_chain_is_repeatable_and_registry_privileges_are_sufficient() {
    let fixture = Fixture::new().await;
    let pool = fixture.pool.clone();
    let result=tokio::spawn(async move {
        let plan=crate::migrations::migration_plan(&pool).await.unwrap();
        assert_eq!(plan.applied_versions,vec![20261014000001,20261014180000,20261022000002,20261027000001]);assert!(plan.pending.is_empty());
        let rows:Vec<(i64,Vec<u8>)>=sqlx::query_as("SELECT version,checksum FROM _sqlx_migrations ORDER BY version").fetch_all(&pool).await.unwrap();
        let migrator=crate::migrations::application_migrator().unwrap();
        for (version,checksum) in rows {assert_eq!(migrator.iter().find(|m|m.version==version).unwrap().checksum.as_ref(),checksum.as_slice());}
        let replayed:bool=sqlx::query_scalar("SELECT (SELECT installed_on FROM _sqlx_migrations WHERE version=20261014180000)>=(SELECT installed_on FROM _sqlx_migrations WHERE version=20261022000002)").fetch_one(&pool).await.unwrap();assert!(replayed);
        let columns:i64=sqlx::query_scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='deal_evidence' AND column_name='content_sha256'").fetch_one(&pool).await.unwrap();assert_eq!(columns,1);
        let privileges:(bool,bool,bool)=sqlx::query_as("SELECT has_table_privilege(current_user,'mediators','SELECT'),has_table_privilege(current_user,'mediators','INSERT'),has_table_privilege(current_user,'mediators','UPDATE')").fetch_one(&pool).await.unwrap();assert_eq!(privileges,(true,true,true));
        let index:bool=sqlx::query_scalar("SELECT to_regclass('public.mediators_status_name') IS NOT NULL").fetch_one(&pool).await.unwrap();assert!(index);
        let invalid=sqlx::query("INSERT INTO mediators(id,pubkey,display_name,status) VALUES($1,$2,'Invalid status','administrator')").bind(uuid::Uuid::new_v4()).bind("11".repeat(32)).execute(&pool).await;assert!(invalid.is_err());
        let invalid_key=sqlx::query("INSERT INTO mediators(id,pubkey,display_name) VALUES($1,'bad-key','Invalid key')").bind(uuid::Uuid::new_v4()).execute(&pool).await;assert!(invalid_key.is_err());
        let before=ledger(&pool).await;crate::migrations::application_migrator().unwrap().run(&pool).await.unwrap();assert_eq!(before,ledger(&pool).await);
    }).await;
    fixture.cleanup().await;
    result.expect("fresh migration verification failed (disposable database removed)");
}

#[tokio::test]
#[ignore = "requires OPENDEAL_TEST_ADMIN_URL; partial-history disposable database only"]
async fn unexpected_partial_historical_order_is_rejected_without_changing_history() {
    let mut partial = sqlx::migrate!("./migrations");
    partial.migrations = std::borrow::Cow::Owned(
        partial
            .iter()
            .filter(|m| [20261014000001, 20261014180000].contains(&m.version))
            .cloned()
            .collect(),
    );
    // Let SQLx genuinely execute and record the partial chain; never fabricate records.
    let fixture = Fixture::new_with_migrator(partial).await;
    let pool = fixture.pool.clone();
    let result = tokio::spawn(async move {
        let before = ledger(&pool).await;
        let error = crate::migrations::migration_plan(&pool).await.unwrap_err();
        assert!(error.to_string().contains("partial history"));
        assert_eq!(before, ledger(&pool).await);
    })
    .await;
    fixture.cleanup().await;
    result.expect("partial history preflight verification failed (disposable database removed)");
}
