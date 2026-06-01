//! Short-lived connect → call → drop wrappers around the
//! `cursor_bridge` crate.
//!
//! Each Tauri command opens a fresh CDP WebSocket, runs one
//! operation, and drops it. Holding the WS open across invocations
//! buys us nothing (every operation re-walks the React fiber via
//! `Runtime.evaluate` anyway) and would force us to maintain a
//! connection-per-window lifecycle on the Rust side that has no
//! useful state.
//!
//! The helpers here are deliberately thin: each one is a
//! "connect → call one lib function → return the lib's result with
//! a stringified error so Tauri serializes it cleanly". Real logic
//! lives in the `cursor_bridge` crate.

use std::sync::Arc;
use std::time::Duration;

use cursor_bridge::{
    discover_targets, inject_delta_observer, list_agents, list_models, list_modes,
    open_new_composer, route_to_composer, send_chat_message_to, set_mode_for_composer,
    set_model_for_composer, AgentHeaderSummary, CdpClient, DeltaPayload, ModeEntry, ModelEntry,
    NewComposerOutcome, RouteOutcome, SendOutcome, Target, TargetType,
};
use tokio_util::sync::CancellationToken;

/// What [`connect_and_send`] returns: the underlying submit outcome
/// plus, when the caller asked us to pre-route to a specific composer,
/// the routing trace.
///
/// Routing is a UI concern (it switches which composer is *visible*),
/// while submission is a service concern (it lands the prompt on the
/// targeted composer regardless of visibility). Callers opt into
/// visible routing only for explicit "show this in Cursor" flows;
/// background sends stay headless and skip UI switching.
pub struct SendBundle {
    pub send: SendOutcome,
    pub route: Option<RouteOutcome>,
}

/// Connect to the renderer at `host:port`, optionally pre-route to a
/// specific composer, run [`send_chat_message_to`], drop the
/// connection.
///
/// `target_id` lets the caller pin a specific renderer page — useful
/// once we support multiple Cursor windows. When `None` and
/// `target_agent_id` is provided, we try every Page target in order
/// so the right window is found even when the user has multiple
/// Cursor windows open (e.g. two projects sharing the same debug
/// port). Without this, `pick_target` would always select the first
/// Page, which may belong to a different Cursor window than the one
/// that owns the target composer.
///
/// `target_agent_id`:
/// - `None` — submit against whatever composer Cursor has selected.
/// - `Some(id)` — submit to that exact composer id. When
///   `route_visible` is also true, first attempt to route the hidden
///   workbench UI to that composer; otherwise do not touch visible
///   selection state.
pub async fn connect_and_send(
    host: &str,
    port: u16,
    target_id: Option<&str>,
    text: &str,
    target_agent_id: Option<&str>,
    route_visible: bool,
) -> Result<SendBundle, String> {
    // When the caller pinned a specific target or has no composer
    // preference, fall back to the simple single-target path.
    if target_id.is_some() || target_agent_id.is_none() {
        return with_client(host, port, target_id, |client| async move {
            let route = match (route_visible, target_agent_id) {
                (true, Some(id)) => Some(
                    route_to_composer(&client, id)
                        .await
                        .map_err(|err| format!("route_to_composer: {err}"))?,
                ),
                _ => None,
            };
            let send = send_chat_message_to(&client, text, target_agent_id)
                .await
                .map_err(|err| format!("send_chat_message_to: {err}"))?;
            Ok(SendBundle { send, route })
        })
        .await;
    }

    // target_agent_id is Some and target_id is None: enumerate all
    // Page targets and try each one until the send succeeds. This
    // handles the common case where the user has multiple Cursor
    // windows open sharing the same --remote-debugging-port, and the
    // composer lives in a window other than the first Page in the list.
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|err| format!("build reqwest client: {err}"))?;
    let all_targets = discover_targets(&http, host, port).await.map_err(|err| {
        format!(
            "could not reach Cursor CDP at {host}:{port} — is the probe instance running? ({err})"
        )
    })?;
    let page_targets: Vec<Target> = all_targets
        .into_iter()
        .filter(|t| matches!(t.target_type, TargetType::Page))
        .collect();

    if page_targets.is_empty() {
        return Err(
            "no Page target among CDP target(s) — renderer may not be ready yet".to_string(),
        );
    }

    let composer_id = target_agent_id.unwrap();
    let page_count = page_targets.len();
    tracing::debug!(
        composer_id,
        page_count,
        "connect_and_send: probing Page targets for owning Cursor window"
    );
    let mut last_err = String::new();
    for (index, page) in page_targets.iter().enumerate() {
        let short_id = short_target_id(&page.id);
        let ws_url = page.ws_url.clone();
        let client = match CdpClient::connect(&ws_url).await {
            Ok(c) => c,
            Err(err) => {
                last_err = format!("connect WS to {ws_url}: {err}");
                tracing::warn!(
                    page = short_id,
                    index,
                    error = %err,
                    "connect_and_send: CDP connect failed, trying next Page"
                );
                continue;
            }
        };
        match send_chat_message_to(&client, text, Some(composer_id)).await {
            Ok(send) => {
                tracing::debug!(
                    page = short_id,
                    index,
                    composer_id,
                    "connect_and_send: prompt landed on owning window"
                );
                let route = if route_visible {
                    route_to_composer(&client, composer_id).await.ok()
                } else {
                    None
                };
                return Ok(SendBundle { send, route });
            }
            Err(err) => {
                last_err = format!("send_chat_message_to on {short_id}: {err}");
                tracing::warn!(
                    page = short_id,
                    index,
                    composer_id,
                    error = %err,
                    "connect_and_send: send failed on Page, trying next"
                );
            }
        }
    }
    tracing::error!(
        composer_id,
        page_count,
        last_err,
        "connect_and_send: prompt failed on every Cursor window"
    );
    Err(format!(
        "send failed on all {page_count} Page target(s) for composer {composer_id}; \
         the composer may belong to a Cursor window without the remote debug port. \
         Last error: {last_err}"
    ))
}

/// Connect, run [`route_to_composer`], drop. Returns the
/// lib-level outcome verbatim (the upstream UI uses `ok` /
/// `reason` to decide what to show).
pub async fn connect_and_route(
    host: &str,
    port: u16,
    target_id: Option<&str>,
    agent_id: &str,
) -> Result<cursor_bridge::RouteOutcome, String> {
    with_client(host, port, target_id, |client| async move {
        route_to_composer(&client, agent_id)
            .await
            .map_err(|err| format!("route_to_composer: {err}"))
    })
    .await
}

/// Connect, run [`list_agents`], drop. Returns the projected
/// composer headers in repository iteration order.
pub async fn connect_and_list_agents(
    host: &str,
    port: u16,
    target_id: Option<&str>,
) -> Result<Vec<AgentHeaderSummary>, String> {
    with_client(host, port, target_id, |client| async move {
        list_agents(&client)
            .await
            .map_err(|err| format!("list_agents: {err}"))
    })
    .await
}

/// Connect, run [`list_models`], drop. Returns Cursor's current
/// available LLM list as the picker would show it.
pub async fn connect_and_list_models(
    host: &str,
    port: u16,
    target_id: Option<&str>,
) -> Result<Vec<ModelEntry>, String> {
    with_client(host, port, target_id, |client| async move {
        list_models(&client)
            .await
            .map_err(|err| format!("list_models: {err}"))
    })
    .await
}

/// Connect, dispatch `composer.createNew`, then type `text` into
/// the freshly-mounted composer. Drops the connection at the end.
///
/// Returned outcome contains the routing trace for `open_new_composer`
/// (so callers can surface "couldn't open new chat — Cursor's UI
/// changed") and the `SendOutcome` for the type-and-submit step.
///
/// We deliberately keep these two steps in one helper so the
/// `commands.rs` layer doesn't have to manage two independent
/// CDP WebSocket connections for what is conceptually one "start a
/// new chat with this prompt" operation.
///
/// `unified_mode` (e.g. `Some("agent")`, `Some("plan")`) seeds the
/// new composer's mode at creation time so we don't have to round-
/// trip through `set_mode_for_composer` afterwards. `None` lets
/// Cursor pick its default.
///
/// The submit uses the new composer's authoritative id (returned
/// by `composerService.createComposer`) — no `[data-composer-id]`
/// poll, no `state.vscdb` diff dance. The two operations are
/// genuinely linked now, not just sequenced.
pub async fn connect_and_create_then_send(
    host: &str,
    port: u16,
    target_id: Option<&str>,
    text: &str,
    unified_mode: Option<&str>,
) -> Result<(NewComposerOutcome, SendOutcome), String> {
    with_client(host, port, target_id, |client| async move {
        let new_outcome = open_new_composer(&client, unified_mode)
            .await
            .map_err(|err| format!("open_new_composer: {err}"))?;

        let new_composer_id = new_outcome.composer_id.clone();
        let send_outcome = send_chat_message_to(&client, text, Some(&new_composer_id))
            .await
            .map_err(|err| format!("send_chat_message_to: {err}"))?;

        Ok((new_outcome, send_outcome))
    })
    .await
}

/// Connect, run [`set_model_for_composer`], drop. Validates the
/// model id against Cursor's catalog inside the eval; an unknown
/// `model_name` propagates as a CDP error.
pub async fn connect_and_set_model(
    host: &str,
    port: u16,
    target_id: Option<&str>,
    composer_id: &str,
    model_name: &str,
) -> Result<(), String> {
    with_client(host, port, target_id, |client| async move {
        set_model_for_composer(&client, composer_id, model_name)
            .await
            .map_err(|err| format!("set_model_for_composer: {err}"))
    })
    .await
}

/// Connect, run [`list_modes`], drop. Returns the unified-mode
/// entries the live Cursor exposes via `composerModesService`,
/// already filtered to the same set the per-composer dropdown shows
/// (the cloud-only `background` mode is dropped upstream).
pub async fn connect_and_list_modes(
    host: &str,
    port: u16,
    target_id: Option<&str>,
) -> Result<Vec<ModeEntry>, String> {
    with_client(host, port, target_id, |client| async move {
        list_modes(&client)
            .await
            .map_err(|err| format!("list_modes: {err}"))
    })
    .await
}

/// Connect, run [`set_mode_for_composer`], drop. Validates the mode
/// id against the live `getAllModes()` list inside the eval; an
/// unknown id propagates as a CDP error rather than silently
/// no-opping.
pub async fn connect_and_set_mode(
    host: &str,
    port: u16,
    target_id: Option<&str>,
    composer_id: &str,
    mode_id: &str,
) -> Result<(), String> {
    with_client(host, port, target_id, |client| async move {
        set_mode_for_composer(&client, composer_id, mode_id)
            .await
            .map_err(|err| format!("set_mode_for_composer: {err}"))
    })
    .await
}

/// Discover → pick → connect helper that hands a live `CdpClient`
/// to the closure and forwards its result.
///
/// Centralizing the connect dance in one place means every helper
/// shares the same target-discovery error message, the same WS
/// connect timeout, and the same target picking rules — a single
/// regression spot when those need to evolve.
async fn with_client<F, Fut, T>(
    host: &str,
    port: u16,
    target_id: Option<&str>,
    op: F,
) -> Result<T, String>
where
    F: FnOnce(CdpClient) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|err| format!("build reqwest client: {err}"))?;

    let targets = discover_targets(&http, host, port).await.map_err(|err| {
        format!(
            "could not reach Cursor CDP at {host}:{port} — is the probe instance running? ({err})"
        )
    })?;

    let target = pick_target(&targets, target_id)?;

    let client = CdpClient::connect(&target.ws_url)
        .await
        .map_err(|err| format!("connect WS to {}: {err}", target.ws_url))?;

    op(client).await
}

/// First 8 characters of a CDP target id, for log lines. Uses a
/// `char` boundary so multi-byte ids never panic on a byte slice.
fn short_target_id(id: &str) -> String {
    id.chars().take(8).collect()
}

fn pick_target<'a>(targets: &'a [Target], explicit_id: Option<&str>) -> Result<&'a Target, String> {
    if let Some(id) = explicit_id {
        return targets
            .iter()
            .find(|t| t.id == id)
            .ok_or_else(|| format!("no CDP target with id={id}"));
    }
    targets
        .iter()
        .find(|t| matches!(t.target_type, TargetType::Page))
        .ok_or_else(|| {
            format!(
                "no Page target among {} CDP target(s) — renderer may not be ready yet",
                targets.len()
            )
        })
}

/// Establish a **persistent** CDP connection, inject the
/// `__orgii_delta__` MutationObserver into the Cursor renderer, and
/// spawn a background task that forwards every `Runtime.bindingCalled`
/// event to `on_delta`.
///
/// Returns a [`CancellationToken`] the caller can cancel to tear down
/// the watcher cleanly. Dropping the token also stops the background
/// task and closes the WebSocket.
///
/// Unlike the short-lived `with_client` helpers, this function does
/// **not** drop the `CdpClient` after the initial setup — the
/// connection must stay alive for the event loop to receive push
/// notifications from the Cursor renderer.
///
/// When `target_id` is `None`, this function tries every Page target
/// in order (same multi-window strategy as `connect_and_send`) so
/// the delta observer is injected into the window that actually owns
/// `composer_id`, not just the first Page in the CDP list.
///
/// The `on_delta` callback receives fully-parsed [`DeltaPayload`]
/// values. It is called from within a `tokio::spawn`'d task, so it
/// must be `Send + Sync + 'static`.
pub async fn connect_and_watch(
    host: &str,
    port: u16,
    target_id: Option<&str>,
    session_id: String,
    composer_id: String,
    on_delta: Arc<dyn Fn(DeltaPayload) + Send + Sync + 'static>,
) -> Result<CancellationToken, String> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|err| format!("build reqwest client: {err}"))?;

    let targets = discover_targets(&http, host, port).await.map_err(|err| {
        format!(
            "could not reach Cursor CDP at {host}:{port} — is Cursor running with --remote-debugging-port? ({err})"
        )
    })?;

    // When the caller pinned a specific target, use it directly.
    // Otherwise try every Page target so the watcher lands on the
    // window that owns the composer (multi-window safety).
    let page_targets: Vec<&Target> = if let Some(id) = target_id {
        targets.iter().filter(|t| t.id == id).collect()
    } else {
        targets
            .iter()
            .filter(|t| matches!(t.target_type, TargetType::Page))
            .collect()
    };

    if page_targets.is_empty() {
        return Err(
            "no Page target among CDP target(s) — renderer may not be ready yet".to_string(),
        );
    }

    let mut last_err = String::new();
    for page in page_targets {
        let short_id = short_target_id(&page.id);
        let client = match CdpClient::connect(&page.ws_url).await {
            Ok(c) => c,
            Err(err) => {
                last_err = format!("connect WS to {}: {err}", page.ws_url);
                tracing::warn!(
                    page = short_id,
                    error = %err,
                    "connect_and_watch: CDP connect failed, trying next Page"
                );
                continue;
            }
        };
        match inject_delta_observer(&client, &session_id, &composer_id).await {
            Ok(binding_rx) => {
                // Successfully injected on this page — spawn the event loop and return.
                let token = CancellationToken::new();
                let token_clone = token.clone();
                tokio::spawn(async move {
                    let _client = client;
                    let mut rx = binding_rx;
                    loop {
                        tokio::select! {
                            _ = token_clone.cancelled() => break,
                            maybe_params = rx.recv() => {
                                match maybe_params {
                                    None => break,
                                    Some(params) => {
                                        let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                        if name != "__orgii_delta__" { continue; }
                                        let payload_str = params.get("payload").and_then(|v| v.as_str()).unwrap_or("");
                                        match serde_json::from_str::<DeltaPayload>(payload_str) {
                                            Ok(delta) if !delta.text.is_empty() => on_delta(delta),
                                            _ => {}
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
                return Ok(token);
            }
            Err(err) => {
                last_err = format!("inject_delta_observer on {short_id}: {err}");
                tracing::warn!(
                    page = short_id,
                    error = %err,
                    "connect_and_watch: observer injection failed, trying next Page"
                );
            }
        }
    }
    Err(format!(
        "watch failed on all Page target(s); last error: {last_err}"
    ))
}
