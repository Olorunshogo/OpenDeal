//! Explicit schema-only entry point. Never starts the API or webhook worker.
use opendeal_api::{migrations::migration_plan, run_migrations};
#[tokio::main]
async fn main() -> std::process::ExitCode {
    let _ = dotenvy::from_filename("crates/opendeal-api/.env");
    let _ = dotenvy::dotenv();
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args
        .first()
        .is_none_or(|arg| arg != "--check" && arg != "--apply")
    {
        eprintln!("Usage: opendeal-migrate --check | --apply [--expect-pending VERSION]");
        return std::process::ExitCode::FAILURE;
    }
    let apply = args[0] == "--apply";
    let expected = if args.len() == 3 && args[1] == "--expect-pending" {
        match args[2].parse::<i64>() {
            Ok(v) => Some(v),
            Err(_) => {
                eprintln!("Invalid expected migration version");
                return std::process::ExitCode::FAILURE;
            }
        }
    } else if args.len() == 1 {
        None
    } else {
        eprintln!("Unexpected arguments");
        return std::process::ExitCode::FAILURE;
    };
    let url = match std::env::var("DATABASE_ADMIN_URL").or_else(|_| std::env::var("DATABASE_URL")) {
        Ok(v) => v,
        Err(_) => {
            eprintln!("Configure DATABASE_ADMIN_URL or DATABASE_URL locally");
            return std::process::ExitCode::FAILURE;
        }
    };
    let result = async {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .map_err(|_| "Cannot connect to selected migration database".to_string())?;
        let result = migration_plan(&pool).await;
        pool.close().await;
        let plan = result.map_err(|e| e.to_string())?;
        println!("{}", serde_json::to_string_pretty(&plan).unwrap());
        if let Some(expected) = expected {
            if plan.pending.len() != 1 || plan.pending[0].version != expected {
                return Err(
                    "Pending migration set differs from the explicit expectation; nothing applied"
                        .into(),
                );
            }
        }
        if apply {
            run_migrations(&url).await.map_err(|e| e.to_string())?;
            println!("Migration application completed; API and workers were not started");
        } else {
            println!("Read-only preflight complete; no schema or migration records changed");
        }
        Ok::<_, String>(())
    }
    .await;
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            std::process::ExitCode::FAILURE
        }
    }
}
