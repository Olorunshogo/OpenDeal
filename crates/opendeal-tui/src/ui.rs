//! Rendering only: reads `App`, never mutates it.

use ratatui::Frame;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Modifier, Style, Stylize};
use ratatui::text::{Line, Span, Text};
use ratatui::widgets::{Block, BorderType, Clear, List, ListItem, ListState, Paragraph, Wrap};

use crate::app::{App, Focus, Level, MENU, Screen, Target};
use crate::identity::{Role, short_key};
use crate::prepared::Field;

const SPINNER: [&str; 8] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

pub fn draw(frame: &mut Frame, app: &App) {
    let [header, body, footer] = Layout::vertical([
        Constraint::Length(3),
        Constraint::Min(8),
        Constraint::Length(4),
    ])
    .areas(frame.area());
    draw_header(frame, app, header);
    let [menu, content] =
        Layout::horizontal([Constraint::Length(33), Constraint::Min(30)]).areas(body);
    draw_menu(frame, app, menu);
    draw_content(frame, app, content);
    draw_footer(frame, app, footer);
    if let Some((label, value, reason)) = &app.manual_copy {
        draw_manual_copy(frame, label, value, reason);
    }
}

fn ok_style() -> Style {
    return Style::new().fg(Color::Green);
}
fn bad_style() -> Style {
    return Style::new().fg(Color::Red);
}
fn warn_style() -> Style {
    return Style::new().fg(Color::Yellow);
}
fn dim() -> Style {
    return Style::new().fg(Color::DarkGray);
}

fn network_span(app: &App) -> Span<'static> {
    return match app.network() {
        Some((n, _)) if n == "regtest" => Span::styled(
            " REGTEST · worthless test coins ",
            Style::new().black().on_green(),
        ),
        Some((n, _)) if n == "bitcoin" || n == "mainnet" => Span::styled(
            " MAINNET · REAL FUNDS · preparation disabled ",
            Style::new().white().on_red().bold(),
        ),
        Some((n, _)) => Span::styled(
            format!(" {} · test network ", n.to_uppercase()),
            Style::new().black().on_yellow(),
        ),
        None => Span::styled(" NETWORK UNKNOWN ", Style::new().white().on_dark_gray()),
    };
}

fn draw_header(frame: &mut Frame, app: &App, area: Rect) {
    let mut spans = vec![
        Span::styled(
            format!(" OpenDeal TUI v{} ", env!("CARGO_PKG_VERSION")),
            Style::new().bold().fg(Color::Cyan),
        ),
        network_span(app),
        Span::raw("  "),
    ];
    match &app.status {
        None => spans.push(Span::styled("API: checking…", dim())),
        Some(s) if s.online() => {
            spans.push(Span::styled("API ● online", ok_style()));
            match &s.database_ready {
                Some(Ok(true)) => spans.push(Span::styled("  DB ● ready", ok_style())),
                Some(Ok(false)) => spans.push(Span::styled("  DB ● unavailable", bad_style())),
                _ => spans.push(Span::styled("  DB ? unknown", warn_style())),
            }
        }
        Some(_) => spans.push(Span::styled("API ● offline", bad_style())),
    }
    if app.refreshing {
        spans.push(Span::raw(format!(
            "  {} refreshing",
            SPINNER[app.tick % SPINNER.len()]
        )));
    }
    let block = Block::bordered().border_type(BorderType::Rounded);
    frame.render_widget(Paragraph::new(Line::from(spans)).block(block), area);
}

fn draw_menu(frame: &mut Frame, app: &App, area: Rect) {
    let items: Vec<ListItem> = MENU
        .iter()
        .enumerate()
        .map(|(i, (label, _))| ListItem::new(format!("{:>2}. {}", i + 1, label)))
        .collect();
    let focused = app.focus == Focus::Menu && app.editing.is_none();
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .title(" Menu ")
        .border_style(if focused { Style::new().cyan() } else { dim() });
    let list = List::new(items)
        .block(block)
        .highlight_style(if focused {
            Style::new().black().on_cyan()
        } else {
            Style::new().add_modifier(Modifier::REVERSED)
        })
        .highlight_symbol("▶ ");
    let mut state = ListState::default().with_selected(Some(app.menu_index));
    frame.render_stateful_widget(list, area, &mut state);
}

fn screen_title(screen: Screen) -> &'static str {
    return match screen {
        Screen::Dashboard => " Dashboard ",
        Screen::LoadFile => " Load browser identities ",
        Screen::Seller => " Seller identity ",
        Screen::Buyer => " Buyer identity ",
        Screen::Mediator => " Mediator (approved registry) ",
        Screen::Keys => " Participant public keys ",
        Screen::Escrow => " Escrow address (2-of-3 P2WSH) ",
        Screen::Terms => " Deal terms ",
        Screen::Export => " Export prepared configuration ",
        Screen::DealId => " Deal ID & links ",
        Screen::Frontend => " Frontend ",
    };
}

fn draw_content(frame: &mut Frame, app: &App, area: Rect) {
    let focused = app.focus == Focus::Content;
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .title(screen_title(app.screen))
        .border_style(if focused { Style::new().cyan() } else { dim() });
    let lines = match app.screen {
        Screen::Dashboard => dashboard(app),
        Screen::LoadFile => load_file(app),
        Screen::Seller => identity_screen(app, Role::Seller),
        Screen::Buyer => identity_screen(app, Role::Buyer),
        Screen::Mediator => mediator_screen(app),
        Screen::Keys => keys_screen(app),
        Screen::Escrow => escrow_screen(app),
        Screen::Terms => terms_screen(app),
        Screen::Export => export_screen(app),
        Screen::DealId => deal_screen(app),
        Screen::Frontend => frontend_screen(app),
    };
    frame.render_widget(
        Paragraph::new(Text::from(lines))
            .block(block)
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn heading(text: &str) -> Line<'static> {
    return Line::styled(text.to_string(), Style::new().bold().underlined());
}

fn kv(label: &str, value: impl Into<String>, style: Style) -> Line<'static> {
    return Line::from(vec![
        Span::styled(format!("{:<24}", label), dim()),
        Span::styled(value.into(), style),
    ]);
}

/// A selectable row; the selected one is highlighted when content has focus.
fn row(app: &App, index: usize, label: &str, value: &str) -> Vec<Line<'static>> {
    let selected = app.focus == Focus::Content && app.cursor == index;
    let marker = if selected { "▶ " } else { "  " };
    let label_style = if selected {
        Style::new().black().on_cyan()
    } else {
        Style::new().bold()
    };
    return vec![
        Line::from(vec![
            Span::raw(marker),
            Span::styled(label.to_string(), label_style),
        ]),
        Line::styled(format!("    {}", value), Style::new().fg(Color::White)),
    ];
}

fn input_line(
    app: &App,
    target: Target,
    label: &str,
    current: &str,
    placeholder: &str,
) -> Vec<Line<'static>> {
    let editing = app.editing.as_ref().filter(|e| e.target == target);
    let value_line = match editing {
        Some(e) => Line::from(vec![
            Span::styled("  ✎ ", warn_style()),
            Span::styled(e.buffer.clone(), Style::new().fg(Color::Yellow)),
            Span::styled(
                "▏",
                Style::new()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::SLOW_BLINK),
            ),
        ]),
        None if current.is_empty() => Line::styled(format!("    {}", placeholder), dim()),
        None => Line::raw(format!("    {}", current)),
    };
    let selected = app.focus == Focus::Content && app.edit_target() == Some(target);
    let label_style = if selected {
        Style::new().black().on_cyan()
    } else {
        Style::new().bold()
    };
    return vec![
        Line::from(vec![
            Span::raw(if selected { "▶ " } else { "  " }),
            Span::styled(label.to_string(), label_style),
        ]),
        value_line,
    ];
}

fn identity_status(app: &App, role: Role) -> Line<'static> {
    return match app.identity(role) {
        Some(id) => {
            let mut spans = vec![
                Span::styled(format!("{:<10}", role.title()), Style::new().bold()),
                Span::styled(format!("✔ {} ", id.short()), ok_style()),
                Span::styled(format!("({})", id.source.describe()), dim()),
            ];
            if role == Role::Mediator && app.mediator_approved() == Some(false) {
                spans.push(Span::styled("  NOT APPROVED", bad_style()));
            }
            Line::from(spans)
        }
        None => Line::from(vec![
            Span::styled(format!("{:<10}", role.title()), Style::new().bold()),
            Span::styled("✘ not set", bad_style()),
        ]),
    };
}

fn dashboard(app: &App) -> Vec<Line<'static>> {
    let mut lines = vec![heading("Backend")];
    lines.push(kv("API URL", app.settings.api_url.clone(), Style::new()));
    match &app.status {
        None => lines.push(kv("Status", "checking…", dim())),
        Some(s) => {
            lines.push(match &s.health {
                Ok(()) => kv("API", "online", ok_style()),
                Err(e) => kv("API", e.to_string(), bad_style()),
            });
            if let Some(ready) = &s.database_ready {
                lines.push(match ready {
                    Ok(true) => kv("Database", "ready (via /health/ready)", ok_style()),
                    Ok(false) => kv(
                        "Database",
                        "unavailable: check `make up` and DATABASE_URL",
                        bad_style(),
                    ),
                    Err(e) => kv("Database", e.to_string(), warn_style()),
                });
            }
            if let Some(Ok(meta)) = &s.meta {
                lines.push(kv(
                    "Settlement model",
                    meta.settlement_model.clone(),
                    Style::new(),
                ));
                lines.push(kv("Custody", meta.custody.clone(), Style::new()));
                lines.push(kv(
                    "Demo routes",
                    if meta.demo_enabled {
                        "enabled (loopback regtest only)"
                    } else {
                        "disabled"
                    },
                    Style::new(),
                ));
            } else if let Some(Err(e)) = &s.meta {
                lines.push(kv("Meta", e.to_string(), bad_style()));
            }
            match &s.mediators {
                Some(Ok((list, rejected))) => {
                    let mut text = format!("{} approved", list.len());
                    if *rejected > 0 {
                        text.push_str(&format!(" ({} invalid entries ignored)", rejected));
                    }
                    lines.push(kv(
                        "Mediator registry",
                        text,
                        if list.is_empty() {
                            warn_style()
                        } else {
                            ok_style()
                        },
                    ));
                }
                Some(Err(e)) => lines.push(kv("Mediator registry", e.to_string(), bad_style())),
                None => {}
            }
            lines.push(kv(
                "Last checked",
                s.checked_at.format("%H:%M:%S UTC").to_string(),
                dim(),
            ));
        }
    }
    if let Some((network, source)) = app.network() {
        lines.push(kv(
            "Network",
            format!("{} (from {})", network, source),
            Style::new().bold(),
        ));
    }
    lines.push(Line::raw(""));
    lines.push(heading("Participants (public keys only)"));
    for role in Role::ALL {
        lines.push(identity_status(app, role));
    }
    lines.push(Line::raw(""));
    lines.push(heading("Prepared deal"));
    lines.push(match &app.escrow {
        Some(d) => kv(
            "Escrow",
            format!("{} (derived, NOT funded)", short_key(&d.address)),
            ok_style(),
        ),
        None => kv("Escrow", "not derived", warn_style()),
    });
    lines.push(if app.issues.is_empty() {
        kv("Deal terms", "valid", ok_style())
    } else {
        kv(
            "Deal terms",
            format!("{} issue(s)", app.issues.len()),
            warn_style(),
        )
    });
    lines.push(match &app.exported_to {
        Some(p) => kv("Export", p.display().to_string(), ok_style()),
        None => kv("Export", "not exported", warn_style()),
    });
    lines.push(match &app.deal_id {
        Some(id) => kv("Deal ID", short_key(id), ok_style()),
        None => kv("Deal ID", "none (deals are created in the browser)", dim()),
    });
    lines.push(Line::raw(""));
    lines.push(heading("Next recommended action"));
    lines.push(Line::styled(
        format!("→ {}", app.next_action()),
        Style::new().fg(Color::Cyan).bold(),
    ));
    return lines;
}

fn load_file(app: &App) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::raw(
            "Load a recovery file from /onboarding (one identity: then press s, b or m for its role),",
        ),
        Line::raw(
            "an earlier three-participant workspace file, or a previously exported prepared deal.",
        ),
        Line::styled(
            "Only public keys, addresses and the deal ID are read. Encrypted keys are never decrypted and no passphrase is asked for.",
            warn_style(),
        ),
        Line::raw(""),
    ];
    lines.extend(input_line(
        app,
        Target::FilePath,
        "File path",
        &app.file_path,
        "path to opendeal-identity-xxxxxxxx.json",
    ));
    if let Some(key) = &app.pending_identity {
        lines.push(Line::raw(""));
        lines.push(Line::styled(
            format!(
                "Identity {} loaded. Assign it: s = seller, b = buyer, m = mediator.",
                short_key(key)
            ),
            Style::new().fg(Color::Cyan).bold(),
        ));
    }
    lines.push(Line::raw(""));
    for role in Role::ALL {
        lines.push(identity_status(app, role));
    }
    if let (Some(key), None) = (&app.candidate_mediator, &app.mediator) {
        lines.push(Line::styled(
            format!(
                "Mediator {} is not approved yet: apply at /mediator, get admin approval, then press r.",
                short_key(key)
            ),
            warn_style(),
        ));
    }
    return lines;
}

fn identity_screen(app: &App, role: Role) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::raw(format!(
            "Paste the {}'s PUBLIC key (64-char x-only or 66-char compressed hex).",
            role.as_str()
        )),
        Line::raw("Keys come from the browser (Copy pubkey after signing in) or a recovery file."),
        Line::styled(
            "Never paste private keys. Signing keys stay in the browser.",
            warn_style(),
        ),
        Line::raw(""),
    ];
    let current = app
        .identity(role)
        .map(|i| i.xonly.clone())
        .unwrap_or_default();
    lines.extend(input_line(
        app,
        Target::Key(role),
        "Public key",
        &current,
        "not set: press Enter or paste",
    ));
    if let Some(id) = app.identity(role) {
        lines.push(Line::raw(""));
        lines.push(kv("Identity (x-only, API)", id.xonly.clone(), Style::new()));
        lines.push(kv("Escrow key (02||x)", id.escrow_key(), Style::new()));
        lines.push(kv("Source", id.source.describe(), dim()));
    }
    if role == Role::Seller {
        lines.push(Line::raw(""));
        lines.push(Line::styled(
            "The seller must be the identity signed in to the browser when the deal is created; the API rejects any other seller.",
            dim(),
        ));
    }
    return lines;
}

fn mediator_screen(app: &App) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::raw(
            "Approved mediators from GET /api/v1/mediators. Enter selects; y copies the key.",
        ),
        Line::styled(
            "Registering a new mediator needs that mediator's signature: apply in the browser at /mediator.",
            dim(),
        ),
        Line::raw(""),
    ];
    let list = app.mediators();
    if list.is_empty() {
        lines.push(Line::styled(
            if app.api_online() {
                "No approved mediators yet."
            } else {
                "API offline: start it and press r."
            },
            warn_style(),
        ));
    }
    for (i, m) in list.iter().enumerate() {
        let mut label = format!("{} [{}]", m.display_name, m.source);
        if app.mediator.as_ref().is_some_and(|s| s.xonly == m.pubkey) {
            label.push_str("  ✔ selected");
        }
        if app.candidate_mediator.as_ref() == Some(&m.pubkey) {
            label.push_str("  (from your file)");
        }
        lines.extend(row(app, i, &label, &m.pubkey));
    }
    if let Some(key) = &app.candidate_mediator
        && !list.iter().any(|m| &m.pubkey == key)
    {
        lines.push(Line::raw(""));
        lines.push(Line::styled(
                format!("Mediator {} from your file is not approved. Apply at /mediator, get admin approval, then press r.", short_key(key)),
                warn_style(),
            ));
    }
    if list.iter().any(|m| m.source == "configuration") {
        lines.push(Line::raw(""));
        lines.push(Line::styled(
            "[configuration] mediators come from MEDIATOR_PUBKEYS; pick one only if you control its key.",
            dim(),
        ));
    }
    return lines;
}

fn keys_screen(app: &App) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::raw("Identity (x-only): what the API stores and what you paste into the frontend."),
        Line::raw("Escrow key (compressed 02||x): what the 2-of-3 witness script contains."),
        Line::raw(""),
    ];
    let items = app.copy_items();
    if items.is_empty() {
        lines.push(Line::styled("No participants yet.", warn_style()));
    }
    for (i, (label, value)) in items.iter().enumerate() {
        lines.extend(row(app, i, label, value));
    }
    return lines;
}

fn escrow_screen(app: &App) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::raw(
            "Press d to derive with opendeal-bitcoin (EscrowKeys::build_escrow), the code the API runs.",
        ),
        Line::raw(""),
    ];
    if let Some((network, source)) = app.network() {
        lines.push(kv(
            "Network",
            format!("{} ({})", network, source),
            Style::new().bold(),
        ));
    }
    lines.push(kv(
        "Script",
        "P2WSH · OP_2 <k1> <k2> <k3> OP_3 OP_CHECKMULTISIG (keys sorted)",
        Style::new(),
    ));
    for role in Role::ALL {
        lines.push(identity_status(app, role));
    }
    lines.push(Line::raw(""));
    if let Some(e) = &app.escrow_error {
        lines.push(Line::styled(format!("✘ {}", e), bad_style()));
    }
    match &app.escrow {
        Some(_) => {
            lines.push(Line::styled(
                "✔ Derived and verified: address matches the witness script and network.",
                ok_style(),
            ));
            lines.push(Line::styled(
                "Status: DERIVED ONLY: not funded, not registered with the API. The API derives this same address after both parties sign (Prepare escrow).",
                warn_style(),
            ));
            lines.push(Line::raw(""));
            for (i, (label, value)) in app.copy_items().iter().enumerate() {
                lines.extend(row(app, i, label, value));
            }
        }
        None if app.escrow_error.is_none() => {
            lines.push(Line::styled("Not derived yet.", warn_style()));
        }
        None => {}
    }
    return lines;
}

fn terms_screen(app: &App) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::raw(
            "Fields match POST /api/v1/deals. Enter edits, Enter saves, Esc cancels, Ctrl+U clears.",
        ),
        Line::raw(""),
    ];
    for field in Field::ALL {
        let value = app.draft.get(field).to_string();
        lines.extend(input_line(
            app,
            Target::Term(field),
            &format!("{}  ({})", field.label(), field.hint()),
            &value,
            "(empty)",
        ));
        for issue in app.issues.iter().filter(|i| i.field == Some(field)) {
            lines.push(Line::styled(
                format!("    ✘ {}", issue.message),
                bad_style(),
            ));
        }
    }
    for issue in app.issues.iter().filter(|i| i.field.is_none()) {
        lines.push(Line::styled(format!("✘ {}", issue.message), bad_style()));
    }
    lines.push(Line::raw(""));
    lines.push(if app.issues.is_empty() {
        Line::styled("✔ Terms valid for this server.", ok_style())
    } else {
        Line::styled("Fix the issues above before exporting.", warn_style())
    });
    lines.push(Line::styled(
        "Currency: BTC · Settlement: bitcoin_multisig_2of3 · The backend validates everything again.",
        dim(),
    ));
    return lines;
}

fn export_screen(app: &App) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::raw("e: validate and write the versioned JSON (schema_version 1, owner-only file)."),
        Line::raw(
            "c: copy the JSON to the clipboard. Contains public data only: no keys, tokens or secrets.",
        ),
        Line::raw(""),
    ];
    lines.extend(input_line(
        app,
        Target::ExportPath,
        "Output file",
        &app.export_path,
        "path",
    ));
    lines.push(Line::raw(""));
    let checks = [
        ("Network known", app.network().is_some()),
        (
            "Seller, buyer, mediator set",
            app.seller.is_some() && app.buyer.is_some() && app.mediator.is_some(),
        ),
        ("Mediator approved", app.mediator_approved() == Some(true)),
        ("Deal terms valid", app.issues.is_empty()),
    ];
    for (label, ok) in checks {
        lines.push(Line::styled(
            format!("{} {}", if ok { "✔" } else { "✘" }, label),
            if ok { ok_style() } else { bad_style() },
        ));
    }
    if app.pending_overwrite.is_some() {
        lines.push(Line::raw(""));
        lines.push(Line::styled(
            "File exists. Press o to overwrite, any other key to cancel.",
            warn_style().bold(),
        ));
    }
    if let Some(path) = &app.exported_to {
        lines.push(Line::raw(""));
        lines.push(Line::styled(
            format!("✔ Prepared (NOT yet a deal): {}", path.display()),
            ok_style(),
        ));
        lines.push(Line::raw(format!(
            "Next: in the browser unlock the seller, open {} → Import prepared configuration → review → Create deal.",
            app.frontend_url("/deals/new")
        )));
    }
    return lines;
}

fn deal_screen(app: &App) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::raw(
            "Deals are created in the browser. Paste the deal ID shown there to keep it handy.",
        ),
        Line::raw("y copies the ID, u copies the deal URL, o opens it, x clears."),
        Line::raw(""),
    ];
    let current = app.deal_id.clone().unwrap_or_default();
    lines.extend(input_line(
        app,
        Target::DealId,
        "Deal ID (64 hex)",
        &current,
        "none: press Enter or paste",
    ));
    if let Some(id) = &app.deal_id {
        lines.push(Line::raw(""));
        lines.push(kv(
            "Deal page",
            app.frontend_url(&format!("/deals/{}", id)),
            Style::new(),
        ));
        lines.push(Line::styled(
            "Deal status requires a signed-in participant: view it on the deal page. This tool holds no session.",
            dim(),
        ));
    }
    return lines;
}

fn frontend_screen(app: &App) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::raw("The browser stays the main interface. y copies a URL, o opens it."),
        Line::raw("Start it with `make frontend` if it is not running."),
        Line::raw(""),
    ];
    for (i, (label, value)) in app.copy_items().iter().enumerate() {
        lines.extend(row(app, i, label, value));
    }
    return lines;
}

fn hints(app: &App) -> &'static str {
    if app.manual_copy.is_some() {
        return "any key: close";
    }
    if app.editing.is_some() {
        return "type/paste · Enter save · Esc cancel · Backspace · Ctrl+U clear";
    }
    if app.pending_overwrite.is_some() {
        return "o overwrite · any other key cancel";
    }
    if app.focus == Focus::Menu {
        return "↑↓ move · Enter open · r refresh · q quit";
    }
    return match app.screen {
        Screen::LoadFile => {
            "Enter edit path · l load · s/b/m assign identity · Esc menu · r refresh"
        }
        Screen::Seller | Screen::Buyer => "Enter edit · paste key · y copy · x clear · Esc menu",
        Screen::Mediator => {
            "↑↓ choose · Enter select · y copy key · x clear · r refresh · Esc menu"
        }
        Screen::Keys => "↑↓ choose · y/Enter copy · Esc menu",
        Screen::Escrow => "d derive · ↑↓ choose · y/Enter copy · Esc menu",
        Screen::Terms => "↑↓ field · Enter edit · paste · Esc menu",
        Screen::Export => "e export · c copy JSON · y copy path · Enter edit path · Esc menu",
        Screen::DealId => {
            "Enter edit · paste · y copy ID · u copy URL · o open · x clear · Esc menu"
        }
        Screen::Frontend => "↑↓ choose · y copy · o open in browser · Esc menu",
        Screen::Dashboard => "Esc menu · r refresh",
    };
}

fn draw_footer(frame: &mut Frame, app: &App, area: Rect) {
    let message = match &app.message {
        Some((level, text)) => {
            let style = match level {
                Level::Info => Style::new(),
                Level::Success => ok_style(),
                Level::Warn => warn_style(),
                Level::Error => bad_style(),
            };
            Line::styled(text.clone(), style)
        }
        None => Line::styled("Ready. Ctrl+C quits from anywhere.", dim()),
    };
    let text = Text::from(vec![message, Line::styled(hints(app), dim())]);
    frame.render_widget(
        Paragraph::new(text)
            .wrap(Wrap { trim: true })
            .block(Block::bordered().border_type(BorderType::Rounded)),
        area,
    );
}

fn draw_manual_copy(frame: &mut Frame, label: &str, value: &str, reason: &str) {
    let area = frame.area();
    let width = area.width.saturating_sub(8).min(100);
    let popup = Rect {
        x: area.x + (area.width.saturating_sub(width)) / 2,
        y: area.y + area.height / 4,
        width,
        height: (area.height / 2).max(8),
    };
    frame.render_widget(Clear, popup);
    let text = Text::from(vec![
        Line::styled(format!("Clipboard unavailable ({}).", reason), warn_style()),
        Line::raw("Select the value below with your mouse/terminal to copy it manually:"),
        Line::raw(""),
        Line::styled(value.to_string(), Style::new().bold()),
        Line::raw(""),
        Line::styled("Press any key to close.", dim()),
    ]);
    frame.render_widget(
        Paragraph::new(text).wrap(Wrap { trim: false }).block(
            Block::bordered()
                .border_type(BorderType::Double)
                .title(format!(" Copy: {} ", label)),
        ),
        popup,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app::{App, Settings};
    use crate::clipboard::tests::FakeClipboard;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    fn render(app: &App) -> String {
        let mut terminal = Terminal::new(TestBackend::new(140, 45)).unwrap();
        terminal.draw(|f| draw(f, app)).unwrap();
        let buffer = terminal.backend().buffer().clone();
        let mut out = String::new();
        for y in 0..buffer.area.height {
            for x in 0..buffer.area.width {
                out.push_str(buffer[(x, y)].symbol());
            }
            out.push('\n');
        }
        return out;
    }

    #[test]
    fn dashboard_renders_name_status_and_next_action() {
        let app = App::new(
            Settings {
                api_url: "http://127.0.0.1:9".into(),
                frontend_url: "http://localhost:3000".into(),
                export_path: "x.json".into(),
                recovery_path: "r.json".into(),
                network_override: Some("regtest".into()),
                identity_files: vec![],
            },
            Box::new(FakeClipboard::default()),
        );
        let screen = render(&app);
        assert!(screen.contains("OpenDeal TUI v0.1.0"));
        assert!(screen.contains("REGTEST"));
        assert!(screen.contains("Next recommended action"));
        assert!(screen.contains("Load browser identities"));
    }
}
