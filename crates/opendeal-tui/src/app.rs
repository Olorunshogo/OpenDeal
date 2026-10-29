//! Application state and keyboard handling. Rendering lives in `ui.rs`; side effects that need
//! threads or processes (status refresh, opening a browser) are returned as [`Effect`]s.

use std::path::PathBuf;

use chrono::Utc;
use opendeal_bitcoin::EscrowDescriptor;
use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

use crate::api::{MediatorEntry, StatusSnapshot};
use crate::clipboard::{Clipboard, CopyOutcome, copy_with_fallback};
use crate::escrow::derive_escrow;
use crate::export::{ExportError, write_file};
use crate::identity::{IdentitySource, PublicIdentity, Role, check_distinct, short_key};
use crate::prepared::{DealDraft, Field, Issue, PreparedDeal, ValidationContext};
use crate::recovery::{
    MAX_RECOVERY_BYTES, is_identity_file, parse_deal_id, parse_identity_file,
    parse_recovery_public_data,
};

const MAX_PASTE_CHARS: usize = 12_000;

#[derive(Debug, Clone)]
pub struct Settings {
    pub api_url: String,
    pub frontend_url: String,
    pub export_path: PathBuf,
    pub recovery_path: PathBuf,
    /// Used only while the API is unreachable.
    pub network_override: Option<String>,
    /// Single-identity recovery files to load at start, each assigned to a role.
    pub identity_files: Vec<(Role, PathBuf)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    Dashboard,
    LoadFile,
    Seller,
    Buyer,
    Mediator,
    Keys,
    Escrow,
    Terms,
    Export,
    DealId,
    Frontend,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuItem {
    Open(Screen),
    Refresh,
    Quit,
}

pub const MENU: [(&str, MenuItem); 13] = [
    ("Dashboard", MenuItem::Open(Screen::Dashboard)),
    ("Load browser identities", MenuItem::Open(Screen::LoadFile)),
    ("Seller identity", MenuItem::Open(Screen::Seller)),
    ("Buyer identity", MenuItem::Open(Screen::Buyer)),
    ("Mediator (registry)", MenuItem::Open(Screen::Mediator)),
    ("Public keys", MenuItem::Open(Screen::Keys)),
    ("Escrow address", MenuItem::Open(Screen::Escrow)),
    ("Deal terms", MenuItem::Open(Screen::Terms)),
    ("Export configuration", MenuItem::Open(Screen::Export)),
    ("Deal ID & links", MenuItem::Open(Screen::DealId)),
    ("Open frontend", MenuItem::Open(Screen::Frontend)),
    ("Refresh status", MenuItem::Refresh),
    ("Quit", MenuItem::Quit),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    Menu,
    Content,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    Refresh,
    OpenUrl(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Info,
    Success,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    FilePath,
    Key(Role),
    Term(Field),
    ExportPath,
    DealId,
}

#[derive(Debug, Clone)]
pub struct Editor {
    pub target: Target,
    pub buffer: String,
}

pub struct App {
    pub settings: Settings,
    pub menu_index: usize,
    pub screen: Screen,
    pub focus: Focus,
    pub should_quit: bool,
    pub status: Option<StatusSnapshot>,
    pub refreshing: bool,
    pub seller: Option<PublicIdentity>,
    pub buyer: Option<PublicIdentity>,
    pub mediator: Option<PublicIdentity>,
    /// Mediator key from the browser recovery file, selected once it shows up as approved.
    pub candidate_mediator: Option<String>,
    /// Public key from a single-identity file, waiting for the user to pick its role.
    pub pending_identity: Option<String>,
    pub escrow: Option<EscrowDescriptor>,
    pub escrow_error: Option<String>,
    pub draft: DealDraft,
    pub issues: Vec<Issue>,
    pub prepared: Option<PreparedDeal>,
    pub exported_to: Option<PathBuf>,
    pub pending_overwrite: Option<String>,
    pub deal_id: Option<String>,
    pub file_path: String,
    pub export_path: String,
    pub cursor: usize,
    pub editing: Option<Editor>,
    pub message: Option<(Level, String)>,
    pub manual_copy: Option<(String, String, String)>,
    pub tick: usize,
    clipboard: Box<dyn Clipboard>,
}

impl App {
    pub fn new(settings: Settings, clipboard: Box<dyn Clipboard>) -> App {
        let file_path = settings.recovery_path.display().to_string();
        let export_path = settings.export_path.display().to_string();
        let mut app = App {
            settings,
            menu_index: 0,
            screen: Screen::Dashboard,
            focus: Focus::Menu,
            should_quit: false,
            status: None,
            refreshing: false,
            seller: None,
            buyer: None,
            mediator: None,
            candidate_mediator: None,
            pending_identity: None,
            escrow: None,
            escrow_error: None,
            draft: DealDraft::default(),
            issues: Vec::new(),
            prepared: None,
            exported_to: None,
            pending_overwrite: None,
            deal_id: None,
            file_path,
            export_path,
            cursor: 0,
            editing: None,
            message: None,
            manual_copy: None,
            tick: 0,
            clipboard,
        };
        app.revalidate_terms();
        return app;
    }

    // === Derived state

    /// Network and where it came from. The API is authoritative.
    pub fn network(&self) -> Option<(String, &'static str)> {
        if let Some(meta) = self.status.as_ref().and_then(|s| s.meta()) {
            return Some((meta.network.clone(), "API /meta"));
        }
        return self
            .settings
            .network_override
            .clone()
            .map(|n| (n, "--network (API offline)"));
    }

    pub fn api_online(&self) -> bool {
        return self.status.as_ref().is_some_and(|s| s.online());
    }

    pub fn mediators(&self) -> &[MediatorEntry] {
        return self
            .status
            .as_ref()
            .map(|s| s.mediator_list())
            .unwrap_or(&[]);
    }

    pub fn mediator_approved(&self) -> Option<bool> {
        let m = self.mediator.as_ref()?;
        if !matches!(
            self.status.as_ref().map(|s| &s.mediators),
            Some(Some(Ok(_)))
        ) {
            return None;
        }
        return Some(self.mediators().iter().any(|e| e.pubkey == m.xonly));
    }

    pub fn identity(&self, role: Role) -> Option<&PublicIdentity> {
        return match role {
            Role::Seller => self.seller.as_ref(),
            Role::Buyer => self.buyer.as_ref(),
            Role::Mediator => self.mediator.as_ref(),
        };
    }

    fn validation_context(&self) -> Option<ValidationContext> {
        let (network, _) = self.network()?;
        let pilot = self
            .status
            .as_ref()
            .and_then(|s| s.meta())
            .and_then(|m| m.pilot_max_amount_sats);
        return Some(ValidationContext {
            network,
            pilot_max_amount_sats: pilot,
            now: Utc::now(),
        });
    }

    pub fn frontend_url(&self, path: &str) -> String {
        return format!("{}{}", self.settings.frontend_url, path);
    }

    pub fn next_action(&self) -> String {
        if self.status.is_none() {
            return "Checking API status…".into();
        }
        if !self.api_online() {
            return "Start the backend: `make up` then `make api`, then press r to refresh.".into();
        }
        if self.seller.is_none() || self.buyer.is_none() {
            return format!(
                "Each participant creates an identity at {} and keeps the recovery file. Load each file here (menu: Load browser identities) or paste public keys.",
                self.frontend_url("/onboarding")
            );
        }
        if self.mediator.is_none() {
            return if self.candidate_mediator.is_some() {
                format!(
                    "Your mediator is not approved yet. The mediator applies at {} and an administrator approves it; then press r.",
                    self.frontend_url("/mediator")
                )
            } else {
                "Select an approved mediator (menu: Mediator).".into()
            };
        }
        if self.mediator_approved() == Some(false) {
            return "The selected mediator is no longer approved. Pick another one.".into();
        }
        if self.escrow.is_none() {
            return "Derive the escrow address (menu: Escrow address, press d).".into();
        }
        if !self.issues.is_empty() {
            return "Complete the deal terms (menu: Deal terms).".into();
        }
        if self.exported_to.is_none() {
            return "Export the configuration (menu: Export configuration, press e).".into();
        }
        if self.deal_id.is_none() {
            return format!(
                "In the browser: sign in as the seller, open {} and use Import prepared configuration, then Create deal. Paste the deal ID here (menu: Deal ID).",
                self.frontend_url("/deals/new")
            );
        }
        return "Continue the signing and funding workflow on the deal page in the browser.".into();
    }

    // === Status

    pub fn begin_refresh(&mut self) -> Vec<Effect> {
        if self.refreshing {
            return vec![];
        }
        self.refreshing = true;
        return vec![Effect::Refresh];
    }

    pub fn apply_status(&mut self, snapshot: StatusSnapshot) {
        self.refreshing = false;
        let previous_network = self.network().map(|n| n.0);
        self.status = Some(snapshot);
        if self.network().map(|n| n.0) != previous_network {
            self.invalidate_escrow();
            self.revalidate_terms();
        }
        if self.mediator.is_none()
            && let Some(key) = self.candidate_mediator.clone()
            && let Some(entry) = self.mediators().iter().find(|m| m.pubkey == key).cloned()
        {
            self.select_mediator(&entry);
            self.info(Level::Success, "Your mediator is approved and selected.");
        }
        if self.cursor >= self.row_count().max(1) {
            self.cursor = 0;
        }
    }

    // === Keyboard

    pub fn handle_key(&mut self, key: KeyEvent) -> Vec<Effect> {
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('c') {
            self.should_quit = true;
            return vec![];
        }
        if self.manual_copy.is_some() {
            self.manual_copy = None;
            return vec![];
        }
        if self.editing.is_some() {
            self.handle_edit_key(key);
            return vec![];
        }
        return match self.focus {
            Focus::Menu => self.handle_menu_key(key),
            Focus::Content => self.handle_content_key(key),
        };
    }

    pub fn handle_paste(&mut self, text: &str) {
        let clean: String = text
            .chars()
            .filter(|c| !c.is_control())
            .take(MAX_PASTE_CHARS)
            .collect();
        if let Some(editor) = self.editing.as_mut() {
            editor.buffer.push_str(&clean);
            return;
        }
        if self.focus == Focus::Content
            && let Some(target) = self.edit_target()
        {
            self.commit(target, clean);
            return;
        }
        self.info(
            Level::Warn,
            "Open a screen with an input field to paste into it.",
        );
    }

    fn handle_menu_key(&mut self, key: KeyEvent) -> Vec<Effect> {
        match key.code {
            KeyCode::Up | KeyCode::Char('k') => {
                self.menu_index = (self.menu_index + MENU.len() - 1) % MENU.len();
                self.preview_menu();
            }
            KeyCode::Down | KeyCode::Char('j') => {
                self.menu_index = (self.menu_index + 1) % MENU.len();
                self.preview_menu();
            }
            KeyCode::Enter | KeyCode::Right | KeyCode::Char('l') | KeyCode::Tab => {
                return self.activate_menu();
            }
            KeyCode::Char('q') => self.should_quit = true,
            KeyCode::Char('r') => return self.begin_refresh(),
            _ => {}
        }
        return vec![];
    }

    fn preview_menu(&mut self) {
        if let MenuItem::Open(screen) = MENU[self.menu_index].1
            && self.screen != screen
        {
            self.screen = screen;
            self.cursor = 0;
            self.pending_overwrite = None;
        }
    }

    fn activate_menu(&mut self) -> Vec<Effect> {
        return match MENU[self.menu_index].1 {
            MenuItem::Open(screen) => {
                if self.screen != screen {
                    self.cursor = 0;
                }
                self.screen = screen;
                if screen != Screen::Dashboard {
                    self.focus = Focus::Content;
                }
                vec![]
            }
            MenuItem::Refresh => self.begin_refresh(),
            MenuItem::Quit => {
                self.should_quit = true;
                vec![]
            }
        };
    }

    fn handle_content_key(&mut self, key: KeyEvent) -> Vec<Effect> {
        if self.pending_overwrite.is_some() {
            match key.code {
                KeyCode::Char('o') => self.export(true),
                _ => {
                    self.pending_overwrite = None;
                    self.info(
                        Level::Info,
                        "Export cancelled; existing file left unchanged.",
                    );
                }
            }
            return vec![];
        }
        let rows = self.row_count();
        match key.code {
            KeyCode::Esc | KeyCode::Tab | KeyCode::Left | KeyCode::Char('h') => {
                self.focus = Focus::Menu;
            }
            KeyCode::Up | KeyCode::Char('k') if rows > 0 => {
                self.cursor = (self.cursor + rows - 1) % rows;
            }
            KeyCode::Down | KeyCode::Char('j') if rows > 0 => {
                self.cursor = (self.cursor + 1) % rows;
            }
            KeyCode::Char('r') => return self.begin_refresh(),
            KeyCode::Enter => {
                if let Some(target) = self.edit_target() {
                    let buffer = match target {
                        // Key and ID inputs start empty so the current value is replaced.
                        Target::Key(_) | Target::DealId => String::new(),
                        other => self.target_value(other),
                    };
                    self.editing = Some(Editor { target, buffer });
                } else if self.screen == Screen::Mediator {
                    self.select_mediator_at_cursor();
                } else {
                    self.copy_selected();
                }
            }
            KeyCode::Char('y') => self.copy_selected(),
            KeyCode::Char('d') if self.screen == Screen::Escrow => self.derive(),
            KeyCode::Char('e') if self.screen == Screen::Export => self.export(false),
            KeyCode::Char('c') if self.screen == Screen::Export => self.copy_json(),
            KeyCode::Char('l') if self.screen == Screen::LoadFile => self.load_file(),
            KeyCode::Char('s') if self.pending_identity.is_some() => {
                self.assign_pending(Role::Seller)
            }
            KeyCode::Char('b') if self.pending_identity.is_some() => {
                self.assign_pending(Role::Buyer)
            }
            KeyCode::Char('m') if self.pending_identity.is_some() => {
                self.assign_pending(Role::Mediator)
            }
            KeyCode::Char('u') if self.screen == Screen::DealId => {
                if let Some(id) = self.deal_id.clone() {
                    self.copy("Deal URL", &self.frontend_url(&format!("/deals/{}", id)));
                }
            }
            KeyCode::Char('o') => return self.open_selected(),
            KeyCode::Char('x') | KeyCode::Delete => self.clear_selected(),
            _ => {}
        }
        return vec![];
    }

    fn handle_edit_key(&mut self, key: KeyEvent) {
        let Some(editor) = self.editing.as_mut() else {
            return;
        };
        match key.code {
            KeyCode::Esc => {
                self.editing = None;
            }
            KeyCode::Enter => {
                let editor = self.editing.take().expect("editing checked above");
                self.commit(editor.target, editor.buffer);
            }
            KeyCode::Backspace => {
                editor.buffer.pop();
            }
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                editor.buffer.clear();
            }
            KeyCode::Char(c)
                if !key.modifiers.contains(KeyModifiers::CONTROL)
                    && editor.buffer.chars().count() < MAX_PASTE_CHARS =>
            {
                editor.buffer.push(c);
            }
            _ => {}
        }
    }

    // === Screen model

    pub fn edit_target(&self) -> Option<Target> {
        return match self.screen {
            Screen::LoadFile => Some(Target::FilePath),
            Screen::Seller => Some(Target::Key(Role::Seller)),
            Screen::Buyer => Some(Target::Key(Role::Buyer)),
            Screen::Terms => Field::ALL.get(self.cursor).map(|f| Target::Term(*f)),
            Screen::Export => Some(Target::ExportPath),
            Screen::DealId => Some(Target::DealId),
            _ => None,
        };
    }

    fn target_value(&self, target: Target) -> String {
        return match target {
            Target::FilePath => self.file_path.clone(),
            Target::Key(role) => self
                .identity(role)
                .map(|i| i.xonly.clone())
                .unwrap_or_default(),
            Target::Term(field) => self.draft.get(field).to_string(),
            Target::ExportPath => self.export_path.clone(),
            Target::DealId => self.deal_id.clone().unwrap_or_default(),
        };
    }

    pub fn row_count(&self) -> usize {
        return match self.screen {
            Screen::Terms => Field::ALL.len(),
            Screen::Mediator => self.mediators().len(),
            _ => self
                .copy_items()
                .len()
                .max(usize::from(self.edit_target().is_some())),
        };
    }

    /// (label, value) pairs the current screen can copy. All values are public.
    pub fn copy_items(&self) -> Vec<(String, String)> {
        let mut items = Vec::new();
        match self.screen {
            Screen::Seller | Screen::Buyer => {
                let role = if self.screen == Screen::Seller {
                    Role::Seller
                } else {
                    Role::Buyer
                };
                if let Some(id) = self.identity(role) {
                    items.push((
                        format!("{} identity (x-only)", role.title()),
                        id.xonly.clone(),
                    ));
                }
            }
            Screen::Keys => {
                for role in Role::ALL {
                    if let Some(id) = self.identity(role) {
                        items.push((
                            format!("{} identity (x-only)", role.title()),
                            id.xonly.clone(),
                        ));
                        items.push((
                            format!("{} escrow key (compressed)", role.title()),
                            id.escrow_key(),
                        ));
                    }
                }
            }
            Screen::Escrow => {
                if let Some(d) = &self.escrow {
                    items.push(("Escrow address".into(), d.address.clone()));
                    items.push(("Witness script (hex)".into(), d.witness_script_hex.clone()));
                    items.push(("scriptPubKey (hex)".into(), d.script_pubkey_hex.clone()));
                }
            }
            Screen::Export => {
                if let Some(path) = &self.exported_to {
                    items.push(("Export path".into(), path.display().to_string()));
                }
            }
            Screen::DealId => {
                if let Some(id) = &self.deal_id {
                    items.push(("Deal ID".into(), id.clone()));
                }
            }
            Screen::Frontend => {
                items.push((
                    "New deal (import here)".into(),
                    self.frontend_url("/deals/new"),
                ));
                items.push((
                    "Sign in / identity".into(),
                    self.frontend_url("/onboarding"),
                ));
                items.push(("Mediator desk".into(), self.frontend_url("/mediator")));
                if let Some(id) = &self.deal_id {
                    items.push((
                        "Deal page".into(),
                        self.frontend_url(&format!("/deals/{}", id)),
                    ));
                }
            }
            Screen::Mediator => {
                for m in self.mediators() {
                    items.push((format!("Mediator {}", m.display_name), m.pubkey.clone()));
                }
            }
            _ => {}
        }
        return items;
    }

    // === Actions

    fn info(&mut self, level: Level, message: impl Into<String>) {
        self.message = Some((level, message.into()));
    }

    fn copy(&mut self, label: &str, value: &str) {
        match copy_with_fallback(self.clipboard.as_mut(), label, value) {
            CopyOutcome::Copied { label } => {
                self.info(Level::Success, format!("{} copied.", label))
            }
            CopyOutcome::Fallback {
                label,
                value,
                reason,
            } => {
                self.manual_copy = Some((label, value, reason));
                self.info(
                    Level::Warn,
                    "Clipboard unavailable; select the value to copy it.",
                );
            }
        }
    }

    fn copy_selected(&mut self) {
        let items = self.copy_items();
        let index = if self.screen == Screen::Seller
            || self.screen == Screen::Buyer
            || self.screen == Screen::DealId
            || self.screen == Screen::Export
        {
            0
        } else {
            self.cursor
        };
        match items.get(index) {
            Some((label, value)) => {
                let (label, value) = (label.clone(), value.clone());
                self.copy(&label, &value);
            }
            None => self.info(Level::Info, "Nothing to copy here yet."),
        }
    }

    fn copy_json(&mut self) {
        match self.prepared.as_ref().map(|p| p.to_json_pretty()) {
            Some(json) => self.copy("Prepared configuration JSON", &json),
            None => self.info(
                Level::Info,
                "Export first (press e); then the JSON can be copied.",
            ),
        }
    }

    fn open_selected(&mut self) -> Vec<Effect> {
        let url = match self.screen {
            Screen::Frontend => self.copy_items().get(self.cursor).map(|i| i.1.clone()),
            Screen::DealId => self
                .deal_id
                .as_ref()
                .map(|id| self.frontend_url(&format!("/deals/{}", id))),
            _ => None,
        };
        return match url {
            Some(url) => {
                self.info(Level::Info, format!("Opening {}", url));
                vec![Effect::OpenUrl(url)]
            }
            None => vec![],
        };
    }

    fn clear_selected(&mut self) {
        match self.screen {
            Screen::Seller => self.set_identity(Role::Seller, None),
            Screen::Buyer => self.set_identity(Role::Buyer, None),
            Screen::Mediator => self.set_identity(Role::Mediator, None),
            Screen::DealId => self.deal_id = None,
            _ => return,
        }
        self.info(Level::Info, "Cleared.");
    }

    fn commit(&mut self, target: Target, value: String) {
        match target {
            Target::FilePath => {
                self.file_path = value.trim().to_string();
                self.load_file();
            }
            Target::Key(role) => {
                // The input is discarded either way; only a validated public key is kept.
                match PublicIdentity::new(role, &value, IdentitySource::Manual) {
                    Ok(id) => {
                        self.set_identity(role, Some(id));
                        self.info(Level::Success, format!("{} public key set.", role.title()));
                        self.warn_if_duplicate();
                    }
                    Err(e) => self.info(Level::Error, e),
                }
            }
            Target::Term(field) => {
                self.draft.set(field, value);
                self.invalidate_export();
                self.revalidate_terms();
            }
            Target::ExportPath => {
                self.export_path = value.trim().to_string();
                self.invalidate_export();
            }
            Target::DealId => match parse_deal_id(&value) {
                Ok(id) => {
                    self.deal_id = Some(id);
                    self.info(Level::Success, "Deal ID saved.");
                }
                Err(e) => self.info(Level::Error, e),
            },
        }
    }

    fn warn_if_duplicate(&mut self) {
        let ids: Vec<&PublicIdentity> =
            Role::ALL.iter().filter_map(|r| self.identity(*r)).collect();
        if let Err(e) = check_distinct(&ids) {
            self.info(Level::Error, e);
        }
    }

    pub fn set_identity(&mut self, role: Role, identity: Option<PublicIdentity>) {
        match role {
            Role::Seller => self.seller = identity,
            Role::Buyer => self.buyer = identity,
            Role::Mediator => self.mediator = identity,
        }
        self.invalidate_escrow();
    }

    fn select_mediator(&mut self, entry: &MediatorEntry) {
        let identity = PublicIdentity {
            role: Role::Mediator,
            xonly: entry.pubkey.clone(),
            source: IdentitySource::Registry {
                display_name: entry.display_name.clone(),
                origin: entry.source.clone(),
            },
        };
        self.set_identity(Role::Mediator, Some(identity));
    }

    fn select_mediator_at_cursor(&mut self) {
        if let Some(entry) = self.mediators().get(self.cursor).cloned() {
            self.select_mediator(&entry);
            self.info(
                Level::Success,
                format!(
                    "Mediator selected: {} ({}).",
                    entry.display_name,
                    short_key(&entry.pubkey)
                ),
            );
            self.warn_if_duplicate();
        }
    }

    fn invalidate_escrow(&mut self) {
        self.escrow = None;
        self.escrow_error = None;
        self.invalidate_export();
    }

    fn invalidate_export(&mut self) {
        self.prepared = None;
        self.exported_to = None;
        self.pending_overwrite = None;
    }

    pub fn revalidate_terms(&mut self) {
        self.issues = match self.validation_context() {
            Some(ctx) => self.draft.to_terms(&ctx).err().unwrap_or_default(),
            None => vec![Issue {
                field: None,
                message: "Network unknown: start the API or pass --network.".into(),
            }],
        };
    }

    pub fn derive(&mut self) {
        self.escrow = None;
        let Some((network, _)) = self.network() else {
            self.escrow_error =
                Some("Network unknown. Start the API (make api) or pass --network regtest.".into());
            return;
        };
        let (Some(s), Some(b), Some(m)) = (&self.seller, &self.buyer, &self.mediator) else {
            let missing: Vec<&str> = Role::ALL
                .iter()
                .filter(|r| self.identity(**r).is_none())
                .map(|r| r.as_str())
                .collect();
            self.escrow_error = Some(format!("Missing participants: {}.", missing.join(", ")));
            return;
        };
        if let Err(e) = check_distinct(&[s, b, m]) {
            self.escrow_error = Some(e);
            return;
        }
        match derive_escrow(&b.xonly, &s.xonly, &m.xonly, &network) {
            Ok(d) => {
                self.escrow_error = None;
                self.escrow = Some(d);
                self.cursor = 0;
                self.info(
                    Level::Success,
                    "Escrow address derived and verified (not funded).",
                );
            }
            Err(e) => self.escrow_error = Some(e),
        }
    }

    pub fn export(&mut self, overwrite: bool) {
        let json = if overwrite {
            match self.pending_overwrite.take() {
                Some(json) => json,
                None => return,
            }
        } else {
            match self.build_prepared() {
                Ok(prepared) => {
                    let json = prepared.to_json_pretty();
                    self.prepared = Some(prepared);
                    json
                }
                Err(message) => {
                    self.info(Level::Error, message);
                    return;
                }
            }
        };
        let path = expand_home(&self.export_path);
        match write_file(&path, &json, overwrite) {
            Ok(()) => {
                self.exported_to = Some(path.clone());
                if let Some(p) = &self.prepared {
                    self.escrow = Some(EscrowDescriptor {
                        network: p.network.clone(),
                        witness_script_hex: p.escrow_preview.witness_script_hex.clone(),
                        script_pubkey_hex: p.escrow_preview.script_pubkey_hex.clone(),
                        address: p.escrow_preview.address.clone(),
                        sorted_pubkeys: p.escrow_preview.sorted_pubkeys.clone(),
                    });
                }
                self.info(
                    Level::Success,
                    format!("Exported to {} (owner-only).", path.display()),
                );
            }
            Err(ExportError::AlreadyExists) => {
                self.pending_overwrite = Some(json);
                self.info(
                    Level::Warn,
                    format!(
                        "{} exists. Press o to overwrite, any other key to cancel.",
                        path.display()
                    ),
                );
            }
            Err(ExportError::Io(e)) => self.info(Level::Error, format!("Export failed: {}", e)),
        }
    }

    fn build_prepared(&mut self) -> Result<PreparedDeal, String> {
        let ctx = self
            .validation_context()
            .ok_or("Network unknown. Start the API or pass --network.")?;
        if ctx.network == "bitcoin" || ctx.network == "mainnet" {
            return Err(
                "Refusing to prepare mainnet deals: this tool is for regtest/test networks.".into(),
            );
        }
        let (Some(s), Some(b), Some(m)) = (&self.seller, &self.buyer, &self.mediator) else {
            return Err("Set seller, buyer and mediator first.".into());
        };
        if self.mediator_approved() == Some(false) {
            return Err("Selected mediator is not in the approved registry.".into());
        }
        let terms = self
            .draft
            .to_terms(&ctx)
            .map_err(|issues| format!("Fix deal terms first: {}", issues[0].message))?;
        let name = match &m.source {
            IdentitySource::Registry { display_name, .. } => Some(display_name.clone()),
            _ => None,
        };
        return PreparedDeal::build(terms, s, b, m, name, &ctx).map_err(|issues| {
            issues
                .iter()
                .map(|i| i.message.clone())
                .collect::<Vec<_>>()
                .join(" ")
        });
    }

    pub fn load_file(&mut self) {
        let path = expand_home(&self.file_path);
        let text = match std::fs::metadata(&path) {
            Ok(meta) if meta.len() as usize > MAX_RECOVERY_BYTES => {
                return self.info(Level::Error, "File is too large to be an OpenDeal file.");
            }
            Ok(_) => match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(e) => return self.info(Level::Error, format!("Cannot read file: {}", e)),
            },
            Err(_) => {
                return self.info(
                    Level::Error,
                    format!(
                        "No file at {}. Each participant downloads their recovery file at /onboarding.",
                        path.display()
                    ),
                );
            }
        };
        let value = serde_json::from_str::<serde_json::Value>(&text).ok();
        if value
            .as_ref()
            .is_some_and(|v| v.get("schema_version").is_some())
        {
            self.load_prepared(&text);
        } else if value.as_ref().is_some_and(is_identity_file) {
            match parse_identity_file(&text) {
                Ok(key) => {
                    self.pending_identity = Some(key);
                    self.info(
                        Level::Info,
                        "Identity file loaded (public key only). Press s = seller, b = buyer, m = mediator.",
                    );
                }
                Err(e) => self.info(Level::Error, e),
            }
        } else {
            self.load_recovery(&text);
        }
    }

    /// Assigns the pending single-identity public key to a role.
    pub fn assign_pending(&mut self, role: Role) {
        let Some(key) = self.pending_identity.take() else {
            return;
        };
        if role == Role::Mediator {
            self.candidate_mediator = Some(key.clone());
            match self.mediators().iter().find(|m| m.pubkey == key).cloned() {
                Some(entry) => {
                    self.select_mediator(&entry);
                    self.info(Level::Success, "Approved mediator selected.");
                }
                None => {
                    self.set_identity(Role::Mediator, None);
                    self.info(
                        Level::Warn,
                        "This mediator is not approved yet: apply at /mediator, have an administrator approve it, then press r.",
                    );
                }
            }
        } else {
            let identity = PublicIdentity {
                role,
                xonly: key,
                source: IdentitySource::RecoveryFile,
            };
            self.set_identity(role, Some(identity));
            self.info(
                Level::Success,
                format!("{} public key set from identity file.", role.title()),
            );
        }
        self.warn_if_duplicate();
    }

    /// Loads `--seller-file` / `--buyer-file` / `--mediator-file` at start.
    pub fn load_identity_files(&mut self) {
        for (role, path) in self.settings.identity_files.clone() {
            self.file_path = path.display().to_string();
            self.load_file();
            if self.pending_identity.is_some() {
                self.assign_pending(role);
            }
        }
    }

    fn load_recovery(&mut self, text: &str) {
        let data = match parse_recovery_public_data(text) {
            Ok(d) => d,
            Err(e) => return self.info(Level::Error, e),
        };
        let make = |role, key: &str| PublicIdentity {
            role,
            xonly: key.to_string(),
            source: IdentitySource::RecoveryFile,
        };
        self.set_identity(Role::Seller, Some(make(Role::Seller, &data.seller)));
        self.set_identity(Role::Buyer, Some(make(Role::Buyer, &data.buyer)));
        self.candidate_mediator = Some(data.mediator.clone());
        if self.draft.payout.is_empty()
            && let Some(p) = data.payout
        {
            self.draft.payout = p;
        }
        if self.draft.refund.is_empty()
            && let Some(r) = data.refund
        {
            self.draft.refund = r;
        }
        if self.deal_id.is_none() {
            self.deal_id = data.deal_id;
        }
        self.revalidate_terms();
        let approved = self
            .mediators()
            .iter()
            .find(|m| m.pubkey == data.mediator)
            .cloned();
        match approved {
            Some(entry) => {
                self.select_mediator(&entry);
                self.info(
                    Level::Success,
                    "Loaded seller, buyer and approved mediator public keys (nothing decrypted).",
                );
            }
            None => {
                self.set_identity(Role::Mediator, None);
                self.info(
                    Level::Warn,
                    "Loaded seller and buyer. The mediator in this file is not approved yet: apply at /mediator and have an administrator approve it, then press r.",
                );
            }
        }
    }

    fn load_prepared(&mut self, text: &str) {
        let Some(ctx) = self.validation_context() else {
            return self.info(
                Level::Error,
                "Network unknown; start the API before loading a prepared file.",
            );
        };
        let prepared = match PreparedDeal::from_json(text, &ctx) {
            Ok(p) => p,
            Err(issues) => {
                return self.info(
                    Level::Error,
                    issues
                        .iter()
                        .map(|i| i.message.clone())
                        .collect::<Vec<_>>()
                        .join(" "),
                );
            }
        };
        let make = |role, key: &str| PublicIdentity {
            role,
            xonly: key.to_string(),
            source: IdentitySource::PreparedConfig,
        };
        self.set_identity(
            Role::Seller,
            Some(make(Role::Seller, &prepared.participants.seller_pubkey)),
        );
        self.set_identity(
            Role::Buyer,
            Some(make(Role::Buyer, &prepared.participants.buyer_pubkey)),
        );
        let mediator_key = prepared.participants.mediator_pubkey.clone();
        match self
            .mediators()
            .iter()
            .find(|m| m.pubkey == mediator_key)
            .cloned()
        {
            Some(entry) => self.select_mediator(&entry),
            None => self.set_identity(Role::Mediator, Some(make(Role::Mediator, &mediator_key))),
        }
        let t = &prepared.deal;
        self.draft = DealDraft {
            title: t.title.clone(),
            description: t.description.clone().unwrap_or_default(),
            amount_sats: t.amount_sats.to_string(),
            deadline: t
                .delivery_deadline
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            acceptance_hours: t.acceptance_window_hours.to_string(),
            payout: t.seller_payout_address.clone(),
            refund: t.buyer_refund_address.clone(),
        };
        self.revalidate_terms();
        self.derive();
        self.info(
            Level::Success,
            "Prepared configuration loaded and re-validated.",
        );
    }
}

pub fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/")
        && let Some(home) = std::env::var_os("HOME")
    {
        return PathBuf::from(home).join(rest);
    }
    return PathBuf::from(path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{Meta, StatusSnapshot};
    use crate::clipboard::tests::FakeClipboard;
    use crate::identity::tests::{test_pubkey_compressed, test_pubkey_xonly};
    use crate::prepared::tests::regtest_address;
    use ratatui::crossterm::event::{KeyEventKind, KeyEventState};

    fn key(code: KeyCode) -> KeyEvent {
        return KeyEvent {
            code,
            modifiers: KeyModifiers::NONE,
            kind: KeyEventKind::Press,
            state: KeyEventState::NONE,
        };
    }

    fn snapshot(mediators: Vec<MediatorEntry>) -> StatusSnapshot {
        return StatusSnapshot {
            health: Ok(()),
            database_ready: Some(Ok(true)),
            meta: Some(Ok(Meta {
                network: "regtest".into(),
                settlement_model: "bitcoin_multisig_2of3".into(),
                custody: "multisig_2of3_no_server_keys".into(),
                pilot_max_amount_sats: None,
                required_confirmations: 1,
                demo_enabled: true,
            })),
            mediators: Some(Ok((mediators, 0))),
            checked_at: Utc::now(),
        };
    }

    fn temp_path(name: &str) -> PathBuf {
        return std::env::temp_dir().join(format!(
            "opendeal-tui-app-{}-{}",
            name,
            std::process::id()
        ));
    }

    fn app(clipboard: FakeClipboard) -> App {
        let settings = Settings {
            api_url: "http://127.0.0.1:9".into(),
            frontend_url: "http://localhost:3000".into(),
            export_path: temp_path("export").join("prepared.json"),
            recovery_path: temp_path("recovery.json"),
            network_override: None,
            identity_files: vec![],
        };
        let mut app = App::new(settings, Box::new(clipboard));
        app.apply_status(snapshot(vec![MediatorEntry {
            pubkey: test_pubkey_xonly(3),
            display_name: "Local demo mediator".into(),
            source: "registry".into(),
        }]));
        return app;
    }

    fn open(app: &mut App, screen: Screen) {
        app.focus = Focus::Menu;
        let index = MENU
            .iter()
            .position(|(_, item)| *item == MenuItem::Open(screen))
            .unwrap();
        while app.menu_index != index {
            app.handle_key(key(KeyCode::Down));
        }
        app.handle_key(key(KeyCode::Enter));
    }

    fn type_text(app: &mut App, text: &str) {
        for c in text.chars() {
            app.handle_key(key(KeyCode::Char(c)));
        }
    }

    #[test]
    fn menu_navigation_wraps_previews_and_quits() {
        let mut app = app(FakeClipboard::default());
        app.handle_key(key(KeyCode::Up));
        assert_eq!(MENU[app.menu_index].0, "Quit");
        app.handle_key(key(KeyCode::Down));
        assert_eq!(app.screen, Screen::Dashboard);
        app.handle_key(key(KeyCode::Down));
        assert_eq!(app.screen, Screen::LoadFile);
        assert_eq!(app.focus, Focus::Menu);
        app.handle_key(key(KeyCode::Enter));
        assert_eq!(app.focus, Focus::Content);
        app.handle_key(key(KeyCode::Esc));
        assert_eq!(app.focus, Focus::Menu);
        app.handle_key(key(KeyCode::Char('q')));
        assert!(app.should_quit);
    }

    #[test]
    fn ctrl_c_quits_even_while_editing() {
        let mut app = app(FakeClipboard::default());
        open(&mut app, Screen::Seller);
        app.handle_key(key(KeyCode::Enter));
        assert!(app.editing.is_some());
        app.handle_key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
        assert!(app.should_quit);
    }

    #[test]
    fn full_preparation_flow_exports_valid_config() {
        let clipboard = FakeClipboard::default();
        let mut app = app(clipboard.clone());
        let _ = std::fs::remove_dir_all(temp_path("export"));

        open(&mut app, Screen::Seller);
        app.handle_paste(&test_pubkey_compressed(1));
        assert_eq!(app.seller.as_ref().unwrap().xonly, test_pubkey_xonly(1));

        open(&mut app, Screen::Buyer);
        app.handle_key(key(KeyCode::Enter));
        type_text(&mut app, &test_pubkey_xonly(2));
        app.handle_key(key(KeyCode::Enter));
        assert!(app.buyer.is_some());

        open(&mut app, Screen::Mediator);
        app.handle_key(key(KeyCode::Enter));
        assert_eq!(app.mediator.as_ref().unwrap().xonly, test_pubkey_xonly(3));

        open(&mut app, Screen::Escrow);
        app.handle_key(key(KeyCode::Char('d')));
        let address = app.escrow.as_ref().unwrap().address.clone();
        app.handle_key(key(KeyCode::Char('y')));
        assert_eq!(clipboard.copied.lock().unwrap().last().unwrap(), &address);

        open(&mut app, Screen::Terms);
        for (field, value) in [
            (Field::Payout, regtest_address(10)),
            (Field::Refund, regtest_address(11)),
        ] {
            app.cursor = Field::ALL.iter().position(|f| *f == field).unwrap();
            app.handle_key(key(KeyCode::Enter));
            app.handle_key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL));
            type_text(&mut app, &value);
            app.handle_key(key(KeyCode::Enter));
        }
        assert!(app.issues.is_empty(), "{:?}", app.issues);

        open(&mut app, Screen::Export);
        app.handle_key(key(KeyCode::Char('e')));
        let path = app.exported_to.clone().expect("exported");
        let text = std::fs::read_to_string(&path).unwrap();
        let ctx = app.validation_context().unwrap();
        let parsed = PreparedDeal::from_json(&text, &ctx).unwrap();
        assert_eq!(parsed.escrow_preview.address, address);
        assert_eq!(
            parsed.participants.mediator_display_name.as_deref(),
            Some("Local demo mediator")
        );

        // Second export asks before overwriting; cancel keeps the file.
        app.handle_key(key(KeyCode::Char('e')));
        assert!(app.pending_overwrite.is_some());
        app.handle_key(key(KeyCode::Char('n')));
        assert!(app.pending_overwrite.is_none());
        app.handle_key(key(KeyCode::Char('e')));
        app.handle_key(key(KeyCode::Char('o')));
        assert!(app.exported_to.is_some());
        let _ = std::fs::remove_dir_all(temp_path("export"));
    }

    #[test]
    fn invalid_key_is_rejected_and_not_kept() {
        let mut app = app(FakeClipboard::default());
        open(&mut app, Screen::Seller);
        app.handle_paste("nsec1thisisnotapublickey");
        assert!(app.seller.is_none());
        let (level, message) = app.message.clone().unwrap();
        assert_eq!(level, Level::Error);
        assert!(!message.contains("thisisnotapublickey"));
    }

    #[test]
    fn identity_change_invalidates_escrow_and_export() {
        let mut app = app(FakeClipboard::default());
        app.set_identity(
            Role::Seller,
            PublicIdentity::new(Role::Seller, &test_pubkey_xonly(1), IdentitySource::Manual).ok(),
        );
        app.set_identity(
            Role::Buyer,
            PublicIdentity::new(Role::Buyer, &test_pubkey_xonly(2), IdentitySource::Manual).ok(),
        );
        app.set_identity(
            Role::Mediator,
            PublicIdentity::new(
                Role::Mediator,
                &test_pubkey_xonly(3),
                IdentitySource::Manual,
            )
            .ok(),
        );
        app.derive();
        assert!(app.escrow.is_some());
        app.set_identity(
            Role::Buyer,
            PublicIdentity::new(Role::Buyer, &test_pubkey_xonly(4), IdentitySource::Manual).ok(),
        );
        assert!(app.escrow.is_none());
    }

    #[test]
    fn derive_reports_missing_prerequisites() {
        let mut app = app(FakeClipboard::default());
        app.derive();
        assert!(
            app.escrow_error
                .as_ref()
                .unwrap()
                .contains("seller, buyer, mediator")
        );
        let mut offline = app;
        offline.status = None;
        offline.derive();
        assert!(
            offline
                .escrow_error
                .as_ref()
                .unwrap()
                .contains("Network unknown")
        );
    }

    #[test]
    fn clipboard_failure_shows_manual_copy_popup() {
        let mut app = app(FakeClipboard {
            fail: true,
            ..Default::default()
        });
        open(&mut app, Screen::Frontend);
        app.handle_key(key(KeyCode::Char('y')));
        let (_, value, _) = app.manual_copy.clone().unwrap();
        assert_eq!(value, "http://localhost:3000/deals/new");
        app.handle_key(key(KeyCode::Char('z')));
        assert!(app.manual_copy.is_none());
    }

    #[test]
    fn recovery_file_loads_public_keys_and_auto_selects_approved_mediator() {
        let mut app = app(FakeClipboard::default());
        let path = temp_path("recovery-load.json");
        let envelope = |role: &str, seed: u8| {
            serde_json::json!({
                "version": 1, "role": role, "pubkey": test_pubkey_xonly(seed),
                "salt": "x", "iv": "y", "ciphertext": "z"
            })
        };
        let file = serde_json::json!({
            "version": 1, "createdAt": "2026-10-28T00:00:00Z",
            "participants": {"seller": envelope("seller", 1), "buyer": envelope("buyer", 2), "mediator": envelope("mediator", 3)},
            "payout": regtest_address(10), "refund": regtest_address(11)
        });
        std::fs::write(&path, file.to_string()).unwrap();
        app.file_path = path.display().to_string();
        app.load_file();
        assert_eq!(
            app.seller.as_ref().unwrap().source,
            IdentitySource::RecoveryFile
        );
        assert!(matches!(
            app.mediator.as_ref().unwrap().source,
            IdentitySource::Registry { .. }
        ));
        assert!(app.issues.is_empty(), "{:?}", app.issues);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn identity_files_are_assigned_to_roles_and_mediator_must_be_approved() {
        let mut app = app(FakeClipboard::default());
        let write = |name: &str, seed: u8| {
            let path = temp_path(name);
            let file = serde_json::json!({
                "version": 1, "kind": "opendeal.identity", "createdAt": "2026-10-29T00:00:00Z",
                "identity": {"pubkey": test_pubkey_xonly(seed), "salt": "x", "iv": "y", "ciphertext": "z"}
            });
            std::fs::write(&path, file.to_string()).unwrap();
            path
        };
        let seller = write("id-seller.json", 1);
        open(&mut app, Screen::LoadFile);
        app.file_path = seller.display().to_string();
        app.handle_key(key(KeyCode::Char('l')));
        assert_eq!(
            app.pending_identity.as_deref(),
            Some(test_pubkey_xonly(1).as_str())
        );
        app.handle_key(key(KeyCode::Char('s')));
        assert_eq!(app.seller.as_ref().unwrap().xonly, test_pubkey_xonly(1));
        assert!(app.pending_identity.is_none());

        // Unapproved mediator: remembered as a candidate, not selected.
        let unapproved = write("id-unapproved.json", 7);
        app.file_path = unapproved.display().to_string();
        app.handle_key(key(KeyCode::Char('l')));
        app.handle_key(key(KeyCode::Char('m')));
        assert!(app.mediator.is_none());
        assert_eq!(
            app.candidate_mediator.as_deref(),
            Some(test_pubkey_xonly(7).as_str())
        );

        // Startup flags load and assign directly; seed 3 is approved in the fixture.
        app.settings.identity_files = vec![
            (Role::Buyer, write("id-buyer.json", 2)),
            (Role::Mediator, write("id-mediator.json", 3)),
        ];
        app.load_identity_files();
        assert_eq!(app.buyer.as_ref().unwrap().xonly, test_pubkey_xonly(2));
        assert!(matches!(
            app.mediator.as_ref().unwrap().source,
            IdentitySource::Registry { .. }
        ));
        for name in [
            "id-seller.json",
            "id-unapproved.json",
            "id-buyer.json",
            "id-mediator.json",
        ] {
            let _ = std::fs::remove_file(temp_path(name));
        }
    }

    #[test]
    fn next_action_guides_through_steps() {
        let mut app = app(FakeClipboard::default());
        assert!(app.next_action().contains("/onboarding"));
        app.status = Some(StatusSnapshot {
            health: Err(crate::api::ApiError::Unreachable(
                "connection refused".into(),
            )),
            database_ready: None,
            meta: None,
            mediators: None,
            checked_at: Utc::now(),
        });
        assert!(app.next_action().contains("make api"));
    }
}
