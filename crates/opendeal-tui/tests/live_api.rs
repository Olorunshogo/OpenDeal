//! Opt-in check against a running API: `OPENDEAL_TUI_LIVE=1 cargo test -p opendeal-tui --test live_api -- --nocapture`
//! Uses random public keys plus an approved registry mediator. Writes only to the temp dir and
//! sends no authenticated requests.

use opendeal_tui::api::StatusSnapshot;
use opendeal_tui::app::{App, Screen, Settings};
use opendeal_tui::clipboard::Clipboard;
use opendeal_tui::identity::{IdentitySource, PublicIdentity, Role};
use opendeal_tui::prepared::{PreparedDeal, ValidationContext};
use ratatui::Terminal;
use ratatui::backend::TestBackend;

struct NoClipboard;
impl Clipboard for NoClipboard {
    fn copy(&mut self, _: &str) -> Result<(), String> {
        Err("disabled in test".into())
    }
}

fn random_pubkey() -> String {
    let secp = bitcoin::secp256k1::Secp256k1::new();
    let (_, pk) = secp.generate_keypair(&mut bitcoin::secp256k1::rand::thread_rng());
    hex::encode(pk.serialize())
}

fn render(app: &App) -> String {
    let mut terminal = Terminal::new(TestBackend::new(150, 48)).unwrap();
    terminal.draw(|f| opendeal_tui::ui::draw(f, app)).unwrap();
    let buffer = terminal.backend().buffer().clone();
    let mut out = String::new();
    for y in 0..buffer.area.height {
        let mut line = String::new();
        for x in 0..buffer.area.width {
            line.push_str(buffer[(x, y)].symbol());
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    out
}

#[test]
fn live_preparation_against_running_api() {
    if std::env::var("OPENDEAL_TUI_LIVE").as_deref() != Ok("1") {
        eprintln!("skipped: set OPENDEAL_TUI_LIVE=1 with the API running");
        return;
    }
    let api = std::env::var("OPENDEAL_API_URL").unwrap_or_else(|_| "http://localhost:8080".into());
    let out = std::env::temp_dir().join(format!("opendeal-tui-live-{}", std::process::id()));
    let mut app = App::new(
        Settings {
            api_url: api.clone(),
            frontend_url: "http://localhost:3000".into(),
            export_path: out.join("prepared.json"),
            recovery_path: out.join("none.json"),
            network_override: None,
            identity_files: vec![],
        },
        Box::new(NoClipboard),
    );
    app.apply_status(StatusSnapshot::collect(&api));
    assert!(app.api_online(), "API at {} is not reachable", api);
    let mediator = app
        .mediators()
        .first()
        .cloned()
        .expect("an approved mediator");
    app.set_identity(
        Role::Seller,
        PublicIdentity::new(Role::Seller, &random_pubkey(), IdentitySource::Manual).ok(),
    );
    app.set_identity(
        Role::Buyer,
        PublicIdentity::new(Role::Buyer, &random_pubkey(), IdentitySource::Manual).ok(),
    );
    app.set_identity(
        Role::Mediator,
        Some(PublicIdentity {
            role: Role::Mediator,
            xonly: mediator.pubkey.clone(),
            source: IdentitySource::Registry {
                display_name: mediator.display_name,
                origin: mediator.source,
            },
        }),
    );
    // Destinations: unrelated random P2WPKH addresses on the API network (never funded).
    let network = opendeal_bitcoin::escrow::parse_network(&app.network().unwrap().0).unwrap();
    let addr = || {
        let pk = bitcoin::CompressedPublicKey::from_slice(&hex::decode(random_pubkey()).unwrap())
            .unwrap();
        bitcoin::Address::p2wpkh(&pk, network).to_string()
    };
    app.draft.payout = addr();
    app.draft.refund = addr();
    app.revalidate_terms();
    app.derive();
    app.export(false);
    let path = app.exported_to.clone().expect("export succeeded");
    let text = std::fs::read_to_string(&path).unwrap();
    let ctx = ValidationContext {
        network: app.network().unwrap().0,
        pilot_max_amount_sats: None,
        now: chrono::Utc::now(),
    };
    let prepared = PreparedDeal::from_json(&text, &ctx).unwrap();
    println!("{}", text);
    for screen in [
        Screen::Dashboard,
        Screen::Mediator,
        Screen::Keys,
        Screen::Escrow,
        Screen::Terms,
        Screen::Export,
    ] {
        app.screen = screen;
        println!("{}", render(&app));
    }
    println!("ESCROW_ADDRESS={}", prepared.escrow_preview.address);
    println!(
        "WITNESS_SCRIPT={}",
        prepared.escrow_preview.witness_script_hex
    );
    let _ = std::fs::remove_dir_all(out);
}
