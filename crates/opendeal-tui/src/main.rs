#![allow(clippy::needless_return, clippy::uninlined_format_args)]

use std::io::stdout;
use std::path::PathBuf;
use std::process::{ExitCode, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use opendeal_tui::api::{StatusSnapshot, validate_base_url};
use opendeal_tui::app::{App, Effect, Settings, expand_home};
use opendeal_tui::clipboard::SystemClipboard;
use opendeal_tui::identity::Role;
use opendeal_tui::ui;
use ratatui::DefaultTerminal;
use ratatui::crossterm::event::{
    self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyEventKind,
};
use ratatui::crossterm::execute;

const USAGE: &str = "opendeal-tui: prepare OpenDeal demo data (public keys, escrow preview, deal terms)

USAGE: opendeal-tui [OPTIONS]

OPTIONS:
  --api-url <URL>        Backend URL        [env OPENDEAL_API_URL, default http://localhost:8080]
  --frontend-url <URL>   Frontend URL       [env OPENDEAL_FRONTEND_URL, default http://localhost:3000]
  --seller-file <PATH>   Seller's recovery file from /onboarding (public key only is read)
  --buyer-file <PATH>    Buyer's recovery file
  --mediator-file <PATH> Mediator's recovery file (must be an approved mediator)
  --recovery <PATH>      Any file to load at start: identity file, earlier workspace
                         file, or a prepared configuration
  --export <PATH>        Output file        [default data/prepared/opendeal-prepared-deal.json]
  --network <NAME>       Network to use only while the API is offline (regtest|testnet|signet)
  -h, --help             Show this help

The TUI reads public data only. It never asks for passphrases or private keys and never
creates, signs, funds or settles deals: do that in the browser.";

fn parse_args() -> Result<(Settings, bool), String> {
    let mut api_url =
        std::env::var("OPENDEAL_API_URL").unwrap_or_else(|_| "http://localhost:8080".into());
    let mut frontend_url =
        std::env::var("OPENDEAL_FRONTEND_URL").unwrap_or_else(|_| "http://localhost:3000".into());
    let mut export_path = PathBuf::from("data/prepared/opendeal-prepared-deal.json");
    let mut recovery: Option<PathBuf> = None;
    let mut network_override = None;
    let mut identity_files: Vec<(Role, PathBuf)> = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = |name: &str| args.next().ok_or(format!("{} needs a value", name));
        match arg.as_str() {
            "-h" | "--help" => {
                println!("{}", USAGE);
                std::process::exit(0);
            }
            "--api-url" => api_url = value("--api-url")?,
            "--frontend-url" => frontend_url = value("--frontend-url")?,
            "--export" => export_path = PathBuf::from(value("--export")?),
            "--recovery" => recovery = Some(expand_home(&value("--recovery")?)),
            "--seller-file" => {
                identity_files.push((Role::Seller, expand_home(&value("--seller-file")?)))
            }
            "--buyer-file" => {
                identity_files.push((Role::Buyer, expand_home(&value("--buyer-file")?)))
            }
            "--mediator-file" => {
                identity_files.push((Role::Mediator, expand_home(&value("--mediator-file")?)))
            }
            "--network" => {
                let n = value("--network")?.to_ascii_lowercase();
                if !["regtest", "testnet", "signet"].contains(&n.as_str()) {
                    return Err("--network must be regtest, testnet or signet".into());
                }
                network_override = Some(n);
            }
            other => return Err(format!("unknown argument {}\n\n{}", other, USAGE)),
        }
    }
    let load_at_start = recovery.is_some();
    let recovery_path = recovery.unwrap_or_else(|| expand_home("~/Downloads/"));
    return Ok((
        Settings {
            api_url: validate_base_url(&api_url).map_err(|e| format!("--api-url: {}", e))?,
            frontend_url: validate_base_url(&frontend_url)
                .map_err(|e| format!("--frontend-url: {}", e))?,
            export_path,
            recovery_path,
            network_override,
            identity_files,
        },
        load_at_start,
    ));
}

fn main() -> ExitCode {
    let (settings, load_at_start) = match parse_args() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{}", e);
            return ExitCode::from(2);
        }
    };
    let mut app = App::new(settings, Box::new(SystemClipboard::default()));
    if load_at_start {
        app.load_file();
    }
    app.load_identity_files();

    // ratatui::init installs a panic hook that restores the terminal before printing.
    let mut terminal = ratatui::init();
    let _ = execute!(stdout(), EnableBracketedPaste);
    let result = run(&mut terminal, &mut app);
    let _ = execute!(stdout(), DisableBracketedPaste);
    ratatui::restore();

    return match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("opendeal-tui: {}", e);
            ExitCode::FAILURE
        }
    };
}

fn run(terminal: &mut DefaultTerminal, app: &mut App) -> std::io::Result<()> {
    let (tx, rx) = mpsc::channel::<StatusSnapshot>();
    let mut effects = app.begin_refresh();
    loop {
        for effect in effects.drain(..) {
            match effect {
                Effect::Refresh => {
                    let tx = tx.clone();
                    let url = app.settings.api_url.clone();
                    std::thread::spawn(move || {
                        let _ = tx.send(StatusSnapshot::collect(&url));
                    });
                }
                Effect::OpenUrl(url) => open_url(&url),
            }
        }
        while let Ok(snapshot) = rx.try_recv() {
            app.apply_status(snapshot);
        }
        terminal.draw(|frame| ui::draw(frame, app))?;
        if app.should_quit {
            return Ok(());
        }
        if event::poll(Duration::from_millis(120))? {
            match event::read()? {
                Event::Key(key) if key.kind == KeyEventKind::Press => {
                    effects = app.handle_key(key);
                }
                Event::Paste(text) => app.handle_paste(&text),
                _ => {}
            }
        }
        app.tick = app.tick.wrapping_add(1);
    }
}

/// Opens one of our own frontend URLs (already validated as http/https) in the default browser.
fn open_url(url: &str) {
    let mut command = if cfg!(target_os = "macos") {
        std::process::Command::new("open")
    } else if cfg!(target_os = "windows") {
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", ""]);
        c
    } else {
        std::process::Command::new("xdg-open")
    };
    let _ = command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}
