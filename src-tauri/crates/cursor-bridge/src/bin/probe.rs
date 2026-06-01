//! `cursor-bridge-probe` — manual + CI driver for `cursor_bridge`.
//!
//! Validated path: launch Cursor with `--remote-debugging-port=<port>`
//! and use [`Cmd::Send`] (which calls the lib's `send_chat_message`)
//! to submit a prompt to the live chat input. See the crate README
//! for the full setup recipe (isolated user-data-dir, etc.).
//!
//! ## Subcommands
//!
//! Validated:
//!  - `list-targets` : show all CDP targets.
//!  - `eval --js <expr>` : raw `Runtime.evaluate` for one-off DOM /
//!    state inspection.
//!  - `send --text <prompt>` : submit a prompt to the live chat input.
//!    Same code path for new chats and follow-ups within an existing
//!    conversation. **This is the supported way to drive Cursor.**
//!
//! Diagnostic / dead-end (kept so we don't re-discover):
//!  - `list-commands [--filter X]` : dump command IDs registered in
//!    the extension host context. Useful for confirming that
//!    `composer.submit` does *not* exist there.
//!  - `start-via-ext-host --text <prompt>` : invoke
//!    `composer.createNew` against the EH command registry. Drafts
//!    a row in `state.vscdb` but never submits.
//!  - `followup-via-ext-host --composer-id <id> --text <prompt>` :
//!    same shape against various candidate follow-up commands. None
//!    submit either.
//!  - `introspect` : dump the EH process scope (process info,
//!    `vscode` reachability, `VSCODE_*` env vars, module cache).
//!
//! ## Global flags
//!
//! - `--port <p>` (default 9229). For `send` you almost always want
//!   `--port 9230` to talk to the renderer.
//! - `--target-filter <substring>` (default `extension-host`). For
//!   `send` pass `--target-filter ""` to attach to the renderer page.
//! - `--target-id <id>` overrides the filter.
//! - `--timeout-secs <n>` raises per-CDP-call timeout.
//! - `--json` switches every subcommand to machine-readable output.

use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use cursor_bridge::{
    discover_targets, list_agents, list_models, route_to_composer, send_chat_message,
    send_chat_message_to, set_model_for_composer, CdpClient, EvalResult, Target, TargetType,
};
use serde_json::json;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(
    name = "cursor-bridge-probe",
    version,
    about = "Phase 1 CDP probe for driving Cursor.app composer commands"
)]
struct Args {
    /// Inspector port. Match what you passed to `--inspect-extensions`.
    #[arg(long, default_value_t = 9229, global = true)]
    port: u16,

    /// Inspector host. Almost always `127.0.0.1`. Exposed for future
    /// over-ssh forwarding projects.
    #[arg(long, default_value = "127.0.0.1", global = true)]
    host: String,

    /// Substring matched against each target's `title` and `url` (case
    /// insensitive). The first target whose `type == "node"` and
    /// matches this filter is used. Pass `""` to attach to the first
    /// node target unconditionally.
    #[arg(long, default_value = "extension-host", global = true)]
    target_filter: String,

    /// If set, attach to a target by its exact `id` (from
    /// `list-targets`). Wins over `--target-filter`.
    #[arg(long, global = true)]
    target_id: Option<String>,

    /// Per-request timeout. CDP slow paths (composer.createNew that
    /// triggers a UI navigation) can take a couple seconds.
    #[arg(long, default_value_t = 30, global = true)]
    timeout_secs: u64,

    /// Emit machine-readable JSON instead of pretty text.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// List all CDP targets exposed by the inspector.
    ListTargets,

    /// Raw `Runtime.evaluate` against the chosen target.
    Eval {
        /// JavaScript expression. Wrap in `(async () => { ... })()`
        /// for multi-statement bodies — `awaitPromise` is on by default.
        #[arg(long)]
        js: String,
    },

    /// Enumerate workbench command IDs by attempting several known
    /// reflection paths in order, since neither the renderer nor the
    /// extension host expose a single canonical "list all commands"
    /// API; we have to try each strategy and report which one worked.
    ListCommands {
        /// Filter the dumped command IDs by this regex (substring
        /// match). Default keeps it tight to our use case.
        #[arg(long, default_value = "composer|aichat|cursor")]
        filter: String,
    },

    /// Send a chat message into the active Cursor renderer prompt
    /// box. Works for both "start a new chat" (when the input is the
    /// landing-page composer) and "follow-up an existing chat" (when
    /// the input is the live conversation's prompt bar).
    ///
    /// Requires `--port` to point at Cursor's renderer CDP endpoint
    /// (i.e. launched with `--remote-debugging-port=<port>`), not the
    /// extension-host inspector. Default `--target-filter` is empty
    /// so we pick the single workbench page.
    ///
    /// `--target-agent-id` (optional) routes to a specific composer
    /// before typing; without it the prompt lands on whatever
    /// composer is currently active.
    Send {
        #[arg(long)]
        text: String,
        /// Switch to this composer id before sending (Phase 3a).
        #[arg(long)]
        target_agent_id: Option<String>,
    },

    /// Switch the standalone Agents view to a specific composer id
    /// (Phase 3a) without sending anything. Returns once both the
    /// DOM `[data-composer-id]` and `glassActiveAgentService` agree
    /// on the target.
    Route {
        #[arg(long)]
        agent_id: String,
    },

    /// Enumerate every composer the probe Cursor knows about
    /// (`agentRepositoryService.delegate._agentHeaderById`). Useful
    /// for picking a target id to pass to `route` or `send`.
    ListAgents,

    /// Read Cursor's available LLM list as the user would see it in
    /// the model picker right now (Phase 3d). Round-trips through
    /// `modelConfigService.getAvailableDefaultModels()`.
    ListModels,

    /// Set the model used for the next prompt on a specific composer.
    /// Most convenient when used together with `route` + `send` from
    /// a script.
    SetModel {
        #[arg(long)]
        agent_id: String,
        #[arg(long)]
        model_name: String,
    },

    /// Legacy: try `composer.createNew` against the extension host's
    /// `vscode.commands` registry. Only *drafts* a composer (writes to
    /// `state.vscdb`) — does not submit. Kept for diagnostic purposes
    /// while iterating on the renderer-driving path; prefer `send`.
    StartViaExtHost {
        #[arg(long)]
        text: String,
    },

    /// Legacy: try follow-up command shapes against an existing
    /// composer via the extension host. None of these actually submit
    /// (see crate-level docs); kept for diagnostics.
    FollowupViaExtHost {
        #[arg(long)]
        composer_id: String,
        #[arg(long)]
        text: String,
    },

    /// Walk the extension host's loaded modules to find which one
    /// owns the workbench command registry. Useful when
    /// `list-commands` returns empty — gives us a starting point for
    /// manual exploration via `eval`.
    Introspect,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("cursor_bridge_probe=info,cursor_bridge=info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let args = Args::parse();

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .context("build reqwest client")?;

    let targets = discover_targets(&http, &args.host, args.port)
        .await
        .with_context(|| {
            format!(
                "discover targets at {}:{} (is Cursor running with --inspect-extensions={}?)",
                args.host, args.port, args.port
            )
        })?;

    if matches!(args.cmd, Cmd::ListTargets) {
        return print_targets(&targets, args.json);
    }

    let target = pick_target(&targets, args.target_id.as_deref(), &args.target_filter)?;
    eprintln!(
        "[probe] attaching to target id={} type={:?} title={:?}",
        target.id, target.target_type, target.title
    );

    let mut client = CdpClient::connect(&target.ws_url).await?;
    client.set_default_timeout(Duration::from_secs(args.timeout_secs));

    match args.cmd {
        Cmd::ListTargets => unreachable!("handled above"),
        Cmd::Eval { js } => run_eval(&client, &js, args.json).await,
        Cmd::ListCommands { filter } => run_list_commands(&client, &filter, args.json).await,
        Cmd::Send {
            text,
            target_agent_id,
        } => run_send(&client, &text, target_agent_id.as_deref(), args.json).await,
        Cmd::Route { agent_id } => run_route(&client, &agent_id, args.json).await,
        Cmd::ListAgents => run_list_agents(&client, args.json).await,
        Cmd::ListModels => run_list_models(&client, args.json).await,
        Cmd::SetModel {
            agent_id,
            model_name,
        } => run_set_model(&client, &agent_id, &model_name, args.json).await,
        Cmd::StartViaExtHost { text } => run_start(&client, &text, args.json).await,
        Cmd::FollowupViaExtHost { composer_id, text } => {
            run_followup(&client, &composer_id, &text, args.json).await
        }
        Cmd::Introspect => run_introspect(&client, args.json).await,
    }
}

async fn run_send(
    client: &CdpClient,
    text: &str,
    target_agent_id: Option<&str>,
    as_json: bool,
) -> Result<()> {
    let outcome = match target_agent_id {
        Some(id) => send_chat_message_to(client, text, Some(id))
            .await
            .context("send_chat_message_to")?,
        None => send_chat_message(client, text)
            .await
            .context("send_chat_message")?,
    };
    if as_json {
        println!("{}", serde_json::to_string_pretty(&outcome)?);
    } else {
        println!("─── send: ok");
        println!("    composer id:   {}", outcome.composer_id);
        println!("    text length:   {}", outcome.text_length);
    }
    Ok(())
}

async fn run_route(client: &CdpClient, agent_id: &str, as_json: bool) -> Result<()> {
    let outcome = route_to_composer(client, agent_id)
        .await
        .context("route_to_composer")?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&outcome)?);
    } else {
        println!(
            "─── route: {} (attempts={:?})",
            if outcome.ok { "ok" } else { "failed" },
            outcome.attempts
        );
        if let Some(reason) = &outcome.reason {
            println!("    reason: {reason}");
        }
        if let Some(before) = &outcome.before_dom {
            println!("    before dom: {before}");
        }
        if let Some(after) = &outcome.after_dom {
            println!("    after dom:  {after}");
        }
    }
    Ok(())
}

async fn run_list_agents(client: &CdpClient, as_json: bool) -> Result<()> {
    let agents = list_agents(client).await.context("list_agents")?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&agents)?);
    } else {
        println!("─── list-agents: {} composer(s)", agents.len());
        for a in &agents {
            let title = a.title.as_deref().unwrap_or("(untitled)");
            let archived = if a.is_archived { " [archived]" } else { "" };
            println!("    {} | {title}{archived}", a.id);
        }
    }
    Ok(())
}

async fn run_list_models(client: &CdpClient, as_json: bool) -> Result<()> {
    let models = list_models(client).await.context("list_models")?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&models)?);
    } else {
        println!("─── list-models: {} model(s)", models.len());
        for m in &models {
            let display = m.client_display_name.as_deref().unwrap_or(&m.name);
            let cap = &m.capabilities;
            println!(
                "    {} | {display} | agent={} thinking={} images={} max={}",
                m.name, cap.agent, cap.thinking, cap.images, cap.max_mode
            );
        }
    }
    Ok(())
}

async fn run_set_model(
    client: &CdpClient,
    agent_id: &str,
    model_name: &str,
    as_json: bool,
) -> Result<()> {
    set_model_for_composer(client, agent_id, model_name)
        .await
        .context("set_model_for_composer")?;
    if as_json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "ok": true,
                "agentId": agent_id,
                "modelName": model_name,
            }))?
        );
    } else {
        println!("─── set-model: ok (agent={agent_id} model={model_name})");
    }
    Ok(())
}

fn pick_target<'a>(
    targets: &'a [Target],
    explicit_id: Option<&str>,
    filter: &str,
) -> Result<&'a Target> {
    if let Some(id) = explicit_id {
        return targets
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| anyhow!("no target with id={id}"));
    }

    // Accept both Node (V8 inspector → extension host) and Page
    // (Chromium remote debugging → renderer / workbench) targets.
    // Renderer access is required for any code that has to reach
    // workbench-side services like ComposerChatService.
    let needle = filter.to_lowercase();
    targets
        .iter()
        .find(|t| {
            matches!(t.target_type, TargetType::Node | TargetType::Page)
                && (filter.is_empty()
                    || t.title.to_lowercase().contains(&needle)
                    || t.url.to_lowercase().contains(&needle))
        })
        .ok_or_else(|| {
            anyhow!(
                "no Node/Page target matched filter `{filter}` ({} targets total — run `list-targets` to inspect)",
                targets.len()
            )
        })
}

fn print_targets(targets: &[Target], as_json: bool) -> Result<()> {
    if as_json {
        println!(
            "{}",
            serde_json::to_string_pretty(
                &targets
                    .iter()
                    .map(|t| json!({
                        "id": t.id,
                        "type": format!("{:?}", t.target_type),
                        "title": t.title,
                        "url": t.url,
                        "ws_url": t.ws_url,
                    }))
                    .collect::<Vec<_>>()
            )?
        );
        return Ok(());
    }

    if targets.is_empty() {
        println!("(no targets — inspector responded but the list is empty; Cursor may not have any extension hosts initialized yet)");
        return Ok(());
    }

    for (i, t) in targets.iter().enumerate() {
        println!(
            "[{i}] id={} type={:?} title={:?}\n     url={}\n     ws ={}",
            t.id, t.target_type, t.title, t.url, t.ws_url
        );
    }
    Ok(())
}

async fn run_eval(client: &CdpClient, js: &str, as_json: bool) -> Result<()> {
    let outcome = client.evaluate(js).await?;
    print_eval_outcome("eval", &outcome, as_json)
}

/// Try a handful of strategies for enumerating registered command IDs.
///
/// We have to brute-force this because the V8 inspector attaches at
/// the **extension host process** scope. The workbench's
/// `CommandsRegistry` lives in the *renderer*, not the EH; from inside
/// the EH we only see the extension API surface (`vscode.commands`).
/// `vscode.commands.getCommands(true)` exists but only works inside an
/// extension activation context. The strategies below try each known
/// way to reach it from a bare `Runtime.evaluate` scope.
async fn run_list_commands(client: &CdpClient, filter: &str, as_json: bool) -> Result<()> {
    let strategies: &[(&str, &str)] = &[
        (
            "globalThis.vscode?.commands?.getCommands",
            r#"
            (async () => {
                if (typeof globalThis.vscode === 'undefined') return { strategy: 'globalThis.vscode', error: 'globalThis.vscode is undefined' };
                const cmds = await globalThis.vscode.commands.getCommands(true);
                return { strategy: 'globalThis.vscode', commands: cmds };
            })()
            "#,
        ),
        (
            "require('vscode').commands.getCommands",
            r#"
            (async () => {
                try {
                    const v = require('vscode');
                    const cmds = await v.commands.getCommands(true);
                    return { strategy: "require('vscode')", commands: cmds };
                } catch (e) {
                    return { strategy: "require('vscode')", error: String(e) };
                }
            })()
            "#,
        ),
        (
            "process.mainModule walk",
            // Long-shot: walk the process's module cache for one whose
            // exports look like the extension API. Worth trying when
            // both of the above fail because it doesn't depend on
            // `vscode` being globally bound.
            r#"
            (() => {
                const cache = require('module')._cache || {};
                const matches = [];
                for (const k of Object.keys(cache)) {
                    if (k.toLowerCase().includes('vscode')) matches.push(k);
                }
                return { strategy: 'module-cache scan', matches: matches.slice(0, 50), totalSeen: matches.length };
            })()
            "#,
        ),
    ];

    let mut report = Vec::with_capacity(strategies.len());

    for (label, expression) in strategies {
        eprintln!("[probe] strategy: {label}");
        match client.evaluate(expression).await? {
            Ok(EvalResult { value, .. }) => {
                report.push(json!({ "strategy": label, "outcome": "ok", "value": value }));
            }
            Err(ex) => {
                report.push(json!({
                    "strategy": label,
                    "outcome": "threw",
                    "text": ex.text,
                    "exception_description": ex.exception.as_ref().and_then(|e| e.description.clone()),
                }));
            }
        }
    }

    // Filter `commands` arrays in-place for readability when not JSON.
    let needle_re = regex_lite(filter);
    if as_json {
        println!("{}", serde_json::to_string_pretty(&report)?);
        return Ok(());
    }

    for entry in &report {
        let strategy = entry
            .get("strategy")
            .and_then(|v| v.as_str())
            .unwrap_or("?");
        let outcome = entry.get("outcome").and_then(|v| v.as_str()).unwrap_or("?");
        println!("─── strategy: {strategy} → {outcome}");
        if outcome == "ok" {
            if let Some(commands) = entry.pointer("/value/commands").and_then(|v| v.as_array()) {
                let mut filtered: Vec<&str> = commands
                    .iter()
                    .filter_map(|v| v.as_str())
                    .filter(|s| needle_re.iter().any(|n| s.to_lowercase().contains(n)))
                    .collect();
                filtered.sort_unstable();
                println!("    matched {} command id(s):", filtered.len());
                for cmd in filtered {
                    println!("      {cmd}");
                }
            } else if let Some(value) = entry.get("value") {
                println!("    raw: {}", serde_json::to_string_pretty(value)?);
            }
        } else {
            println!(
                "    text: {}\n    exception: {}",
                entry.get("text").and_then(|v| v.as_str()).unwrap_or(""),
                entry
                    .get("exception_description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("(none)"),
            );
        }
    }
    Ok(())
}

/// Quick & dirty alternation parser — splits on `|` and lowercases.
/// We use this instead of pulling in the `regex` crate just for one
/// substring match.
fn regex_lite(filter: &str) -> Vec<String> {
    filter
        .split('|')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}

async fn run_start(client: &CdpClient, text: &str, as_json: bool) -> Result<()> {
    // We try the most likely command IDs in order, returning the
    // first one that doesn't throw. The result of `executeCommand`
    // for `composer.createNew` is undocumented — we capture whatever
    // it returns and inspect it via the probe output.
    let escaped_text = serde_json::to_string(text)?;
    let candidates: &[(&str, String)] = &[
        (
            "composer.createNew",
            format!(
                r#"(async () => {{
                    const v = require('vscode');
                    return await v.commands.executeCommand('composer.createNew', {{ text: {escaped_text} }});
                }})()"#
            ),
        ),
        (
            "composer.startComposerPrompt",
            format!(
                r#"(async () => {{
                    const v = require('vscode');
                    return await v.commands.executeCommand('composer.startComposerPrompt', {{ text: {escaped_text} }});
                }})()"#
            ),
        ),
        (
            "composer.startComposerPrompt2",
            format!(
                r#"(async () => {{
                    const v = require('vscode');
                    return await v.commands.executeCommand('composer.startComposerPrompt2', {{ text: {escaped_text} }});
                }})()"#
            ),
        ),
        (
            "aichat.newchataction",
            format!(
                r#"(async () => {{
                    const v = require('vscode');
                    return await v.commands.executeCommand('aichat.newchataction', {{ text: {escaped_text} }});
                }})()"#
            ),
        ),
    ];

    for (name, expression) in candidates {
        eprintln!("[probe] try start command: {name}");
        let outcome = client.evaluate(expression).await?;
        let label = format!("start[{name}]");
        print_eval_outcome(&label, &outcome, as_json)?;
        if outcome.is_ok() {
            return Ok(());
        }
    }
    Ok(())
}

async fn run_followup(
    client: &CdpClient,
    composer_id: &str,
    text: &str,
    as_json: bool,
) -> Result<()> {
    let escaped_text = serde_json::to_string(text)?;
    let escaped_id = serde_json::to_string(composer_id)?;
    let candidates: &[(&str, String)] = &[
        (
            "aichat.newfollowupaction",
            format!(
                r#"(async () => {{
                    const v = require('vscode');
                    return await v.commands.executeCommand('aichat.newfollowupaction', {{ composerId: {escaped_id}, text: {escaped_text} }});
                }})()"#
            ),
        ),
        (
            "composer.startComposerPrompt2 (with composerId)",
            format!(
                r#"(async () => {{
                    const v = require('vscode');
                    return await v.commands.executeCommand('composer.startComposerPrompt2', {{ composerId: {escaped_id}, text: {escaped_text} }});
                }})()"#
            ),
        ),
        (
            "composer.submit",
            format!(
                r#"(async () => {{
                    const v = require('vscode');
                    return await v.commands.executeCommand('composer.submit', {{ composerId: {escaped_id}, text: {escaped_text} }});
                }})()"#
            ),
        ),
        (
            "composer.sendToAgent",
            format!(
                r#"(async () => {{
                    const v = require('vscode');
                    return await v.commands.executeCommand('composer.sendToAgent', {{ composerId: {escaped_id}, text: {escaped_text} }});
                }})()"#
            ),
        ),
    ];

    for (name, expression) in candidates {
        eprintln!("[probe] try followup command: {name}");
        let outcome = client.evaluate(expression).await?;
        let label = format!("followup[{name}]");
        print_eval_outcome(&label, &outcome, as_json)?;
        if outcome.is_ok() {
            return Ok(());
        }
    }
    Ok(())
}

async fn run_introspect(client: &CdpClient, as_json: bool) -> Result<()> {
    // Surface useful "where am I" diagnostics so we can reason about
    // which scope `Runtime.evaluate` is running in.
    let expression = r#"
    (() => {
        const out = {
            argv: process.argv,
            execArgv: process.execArgv,
            versions: process.versions,
            cwd: process.cwd(),
            globals: {
                hasGlobalThisVscode: typeof globalThis.vscode !== 'undefined',
                hasRequire: typeof require === 'function',
                hasModule: typeof module !== 'undefined',
            },
            moduleCacheKeysWithVscode: Object.keys(require('module')._cache || {})
                .filter(k => k.toLowerCase().includes('vscode'))
                .slice(0, 30),
            envVscode: Object.keys(process.env)
                .filter(k => k.startsWith('VSCODE_'))
                .reduce((acc, k) => { acc[k] = process.env[k]; return acc; }, {}),
        };
        return out;
    })()
    "#;

    let outcome = client.evaluate(expression).await?;
    print_eval_outcome("introspect", &outcome, as_json)
}

fn print_eval_outcome(
    label: &str,
    outcome: &cursor_bridge::EvalOutcome,
    as_json: bool,
) -> Result<()> {
    if as_json {
        let payload = match outcome {
            Ok(result) => json!({
                "label": label,
                "outcome": "ok",
                "type": result.kind,
                "value": result.value,
                "description": result.description,
            }),
            Err(ex) => json!({
                "label": label,
                "outcome": "threw",
                "text": ex.text,
                "exception": ex.exception.as_ref().map(|e| json!({
                    "type": e.kind,
                    "value": e.value,
                    "description": e.description,
                })),
                "line": ex.line_number,
                "column": ex.column_number,
            }),
        };
        println!("{}", serde_json::to_string_pretty(&payload)?);
    } else {
        match outcome {
            Ok(result) => {
                println!("─── {label}: ok (type={})", result.kind);
                if let Some(value) = &result.value {
                    println!("    value: {}", serde_json::to_string_pretty(value)?);
                } else if let Some(desc) = &result.description {
                    println!("    description: {desc}");
                }
            }
            Err(ex) => {
                println!("─── {label}: threw");
                println!("    text: {}", ex.text);
                if let Some(exc) = &ex.exception {
                    if let Some(desc) = &exc.description {
                        println!("    description: {desc}");
                    }
                }
                println!("    at line {}, col {}", ex.line_number, ex.column_number);
            }
        }
    }
    Ok(())
}
