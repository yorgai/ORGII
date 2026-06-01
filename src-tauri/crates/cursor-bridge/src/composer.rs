//! High-level "create / submit Cursor chat" API via Cursor's own
//! workbench services.
//!
//! ## Design
//!
//! Cursor's renderer exposes a small set of internal services that
//! together implement the chat surface:
//!
//! - `composerService.createComposer({partialState, openInNewTab, …})`
//!   — creates a new composer row in `state.vscdb` and returns
//!   `{ composerId }` synchronously. This is what Cursor's own
//!   "New Chat" button calls under the hood.
//! - `composerChatService.submitChatMaybeAbortCurrent(composerId, text, opts?)`
//!   — submits a prompt against an existing composer. Same call
//!   path Cursor uses for plan execution, the in-app browser's
//!   "ask about this element", and stop-hook auto-followups.
//! - `composerDataService.updateComposerData(composerId, {text, richText})`
//!   — pre-populates the composer's input box. Useful for
//!   debugging / verification but not strictly required for submit.
//!
//! All three are reachable from any DOM element via the React fiber
//! walk in [`crate::workbench::PRELUDE`]. We do not need a composer
//! to already exist in the DOM, which means this works on a
//! freshly-spawned probe with an empty `state.vscdb`.
//!
//! ## Why this replaces the old DOM-driving approach
//!
//! Phase 1–4 used CDP `Input.insertText` + `Input.dispatchKeyEvent`
//! to type into the live ProseMirror editor and press Enter. That
//! worked but had several brittleness modes:
//!
//! 1. Required a focused `.ui-prompt-input-editor__input` in the
//!    DOM — broke when the workbench wasn't on a composer view.
//! 2. Required the new composer to mount within 3 s before we could
//!    type — broke on a cold probe (no `[data-composer-id]` to
//!    poll for change).
//! 3. Tied us to ProseMirror's exact submit handler — would break
//!    if Cursor switched editors.
//!
//! Going through `composerChatService` directly is the same channel
//! the user's Enter key eventually feeds into, just one layer
//! higher. No DOM dependency, no input focus dance, no Enter key
//! press, no polling for mount.
//!
//! ## What we lost
//!
//! The old `Input.*` path produced visible UI feedback (the user
//! could literally watch the prompt appear in the input box and
//! submit). The service-direct path is invisible — the prompt
//! appears as a sent bubble with no intermediate "draft" state.
//! That's a UX win for our use case (a human is not watching the
//! probe Cursor) but worth noting if we ever want to drive a
//! Cursor the user is interacting with.

use serde_json::{json, Value};
use tokio::sync::mpsc;
use tracing::{debug, info};

use crate::cdp::CdpClient;
use crate::error::{CdpError, Result};
use crate::workbench;

/// Submit a prompt to a Cursor composer via
/// `composerChatService.submitChatMaybeAbortCurrent`.
///
/// `target_composer_id`:
/// - `Some(id)` — submit against the specified composer. The probe
///   does not need that composer to be the visible/active one —
///   the service operates on any composer in the repository.
/// - `None` — submit against whichever composer is currently
///   selected (`composerDataService.selectedComposerId`). Errors if
///   none is selected (cold probe with no composer); use
///   [`open_new_composer`] first in that case.
///
/// This function does **not** route the UI to the target composer.
/// The submit lands on whichever composer the caller specifies
/// regardless of which one is visible. If the caller wants the
/// probe Cursor's UI to reflect the targeted conversation (e.g.
/// for "open this chat" affordances), call
/// [`crate::routing::route_to_composer`] separately first.
///
/// Caller is responsible for connecting `client` to a renderer
/// `Page` target.
pub async fn send_chat_message_to(
    client: &CdpClient,
    text: &str,
    target_composer_id: Option<&str>,
) -> Result<SendOutcome> {
    let target_id_js = match target_composer_id {
        Some(id) => serde_json::to_string(id).expect("string serializes"),
        None => "null".to_string(),
    };
    let text_js = serde_json::to_string(text).expect("string serializes");

    let expression = format!(
        r#"
    (async () => {{
      {prelude}

      const TARGET_ID = {target_id};
      const TEXT = {text};

      const is = findInstantiationService();
      const composerDataService = lookupService(is, "composerDataService");
      const composerChatService = lookupService(is, "composerChatService");
      if (!composerDataService) throw new Error("composerDataService not registered");
      if (!composerChatService) throw new Error("composerChatService not registered");

      // Decide which composer we're submitting against. Caller can
      // either pin it explicitly or let us fall back to whatever
      // Cursor has selected.
      let composerId = TARGET_ID;
      if (!composerId) {{
        const selected = composerDataService.selectedComposerId;
        if (!selected) {{
          throw new Error("no target composer id supplied and composerDataService has no selection");
        }}
        composerId = selected;
      }}

      // Actually submit. The Promise this returns resolves once the
      // request is dispatched (not once the assistant has replied);
      // streaming bubbles will continue arriving via Cursor's normal
      // reactive channels.
      await composerChatService.submitChatMaybeAbortCurrent(composerId, TEXT);

      return {{
        ok: true,
        composerId: String(composerId),
        textLength: TEXT.length,
      }};
    }})()
    "#,
        prelude = workbench::PRELUDE,
        target_id = target_id_js,
        text = text_js,
    );

    match client.evaluate(&expression).await? {
        Ok(result) => {
            let value = result.value.unwrap_or(json!({}));
            let parsed: WireSubmitResult =
                serde_json::from_value(value.clone()).map_err(|source| {
                    CdpError::MalformedResponse {
                        context: format!("submit outcome not deserializable: {source}"),
                        body: value.to_string(),
                    }
                })?;
            info!(
                composer_id = %parsed.composer_id,
                text_len = parsed.text_length,
                "submitted chat via composerChatService"
            );
            Ok(SendOutcome {
                composer_id: parsed.composer_id,
                text_length: parsed.text_length,
            })
        }
        Err(ex) => Err(CdpError::ProtocolError {
            code: 0,
            message: format!(
                "submit eval threw: {} ({})",
                ex.text,
                ex.exception
                    .as_ref()
                    .and_then(|e| e.description.clone())
                    .unwrap_or_default()
            ),
        }),
    }
}

/// Convenience wrapper: submit against the currently-selected
/// composer (caller doesn't care which one).
pub async fn send_chat_message(client: &CdpClient, text: &str) -> Result<SendOutcome> {
    send_chat_message_to(client, text, None).await
}

/// Outcome of a submit. The composer id is always present (it's
/// either the one the caller pinned or the one Cursor had selected
/// at submit time), so callers can reliably correlate the prompt
/// with the resulting `state.vscdb` row.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SendOutcome {
    pub composer_id: String,
    pub text_length: u64,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireSubmitResult {
    composer_id: String,
    text_length: u64,
}

/// Create a fresh composer in the probe Cursor.
///
/// Wraps `composerService.createComposer({partialState, openInNewTab})`
/// which is the same call Cursor's own "New Chat" button (and its
/// plan execution / CI failure / spec subagent flows) makes.
/// Returns the new composer's id immediately — no DOM polling, no
/// dependency on a pre-existing composer.
///
/// `unified_mode` controls which mode the new composer boots into.
/// Pass `Some("agent")`, `Some("plan")`, `Some("ask")`, etc. to
/// match Cursor's `composerModesService` ids. `None` lets Cursor
/// pick its default (currently `"agent"`).
///
/// Pair with [`send_chat_message_to`] (passing the returned
/// `composer_id`) to seed the new composer with the user's first
/// prompt.
pub async fn open_new_composer(
    client: &CdpClient,
    unified_mode: Option<&str>,
) -> Result<NewComposerOutcome> {
    let partial_state = match unified_mode {
        Some(mode) => json!({ "unifiedMode": mode }),
        None => Value::Object(serde_json::Map::new()),
    };
    let partial_state_js = serde_json::to_string(&partial_state).expect("partial state serializes");

    let expression = format!(
        r#"
    (async () => {{
      {prelude}

      const PARTIAL_STATE = {partial};

      const is = findInstantiationService();
      const composerService = lookupService(is, "composerService");
      if (!composerService) throw new Error("composerService not registered");
      if (typeof composerService.createComposer !== "function") {{
        throw new Error("composerService.createComposer is not a function");
      }}

      // Cursor's own "New Chat" button calls this same shape.
      // `openInNewTab: false` keeps the new composer in the current
      // tab (we don't want to spawn an extra Electron window for
      // every prompt). `partialState.unifiedMode` is the only
      // partial-state field we currently care about; everything
      // else (model config, repo context, …) Cursor fills in.
      const result = await composerService.createComposer({{
        partialState: PARTIAL_STATE,
        openInNewTab: false,
      }});

      if (!result || !result.composerId) {{
        throw new Error("composerService.createComposer returned no composerId");
      }}

      return {{
        ok: true,
        composerId: String(result.composerId),
        unifiedMode: PARTIAL_STATE.unifiedMode ?? null,
      }};
    }})()
    "#,
        prelude = workbench::PRELUDE,
        partial = partial_state_js,
    );

    match client.evaluate(&expression).await? {
        Ok(result) => {
            let value = result.value.unwrap_or(json!({}));
            let parsed: NewComposerOutcome =
                serde_json::from_value(value.clone()).map_err(|source| {
                    CdpError::MalformedResponse {
                        context: format!("createComposer outcome not deserializable: {source}"),
                        body: value.to_string(),
                    }
                })?;
            info!(
                composer_id = %parsed.composer_id,
                ?parsed.unified_mode,
                "created new composer via composerService"
            );
            Ok(parsed)
        }
        Err(ex) => {
            debug!(
                ?unified_mode,
                "open_new_composer eval threw: {} ({})",
                ex.text,
                ex.exception
                    .as_ref()
                    .and_then(|e| e.description.clone())
                    .unwrap_or_default(),
            );
            Err(CdpError::ProtocolError {
                code: 0,
                message: format!(
                    "open_new_composer eval threw: {} ({})",
                    ex.text,
                    ex.exception
                        .as_ref()
                        .and_then(|e| e.description.clone())
                        .unwrap_or_default()
                ),
            })
        }
    }
}

/// Result of [`open_new_composer`]. The `composer_id` is the
/// authoritative id Cursor allocated — no more "DOM and persistent
/// id might disagree" caveat from the old polling-based path.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewComposerOutcome {
    pub ok: bool,
    pub composer_id: String,
    /// Echo of the `unifiedMode` we requested (or `None` if we let
    /// Cursor pick the default). Lets the caller assert that the
    /// new composer actually booted into the requested mode.
    #[serde(default)]
    pub unified_mode: Option<String>,
}

/// Payload carried by each `Runtime.bindingCalled` event for the
/// `__orgii_delta__` binding. Deserialized from the JSON string
/// the JS side passes as the binding argument.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct DeltaPayload {
    /// ORGII `cursoride-<uuid>` session id — lets the broadcast
    /// router deliver the event to the right IPC channel.
    pub session_id: String,
    /// Incremental text appended since the last observation. May be
    /// empty when the observer fires on a non-text mutation; callers
    /// should skip empty deltas rather than broadcasting noise.
    pub text: String,
}

/// Register a `Runtime.addBinding` named `__orgii_delta__` and inject
/// a `MutationObserver` that watches the composer bubble for the given
/// `composer_id`. Whenever Cursor appends new text to the assistant
/// response, the observer calls `window.__orgii_delta__(payload)` which
/// fires a `Runtime.bindingCalled` CDP event back to us.
///
/// Returns a receiver of raw `Runtime.bindingCalled` params values.
/// Callers should filter on `name == "__orgii_delta__"` and parse
/// `payload` as a JSON-encoded `DeltaPayload`.
///
/// The observer is intentionally scoped to a single composer so
/// simultaneous watches on different sessions don't cross-fire.
pub async fn inject_delta_observer(
    client: &CdpClient,
    session_id: &str,
    composer_id: &str,
) -> Result<mpsc::UnboundedReceiver<Value>> {
    // Register the host-side binding *before* injecting the JS so
    // the binding is already present when the observer fires.
    client.add_binding("__orgii_delta__").await?;

    let session_id_js = serde_json::to_string(session_id).expect("string serializes");
    let composer_id_js = serde_json::to_string(composer_id).expect("string serializes");

    // Injected JS: locate the composer's response container and set up
    // a MutationObserver that fires on every text node addition.
    //
    // Design choices:
    // - We watch `childList` + `subtree` on the whole composer container
    //   so we catch both new bubble elements and text appended inside them.
    // - `lastLength` tracks how many characters we've already seen in the
    //   *current* (last) assistant bubble — only the delta is sent.
    // - We filter to the last bubble (Cursor always appends to the end)
    //   to avoid re-sending text from earlier turns when the DOM is rebuilt.
    // - The observer is deliberately *not* disconnected here; the Rust
    //   side drives teardown by dropping the receiver and cancelling the
    //   watch task, which closes the long-lived CDP WebSocket.
    let expression = format!(
        r#"
(async () => {{
  const SESSION_ID = {session_id};
  const COMPOSER_ID = {composer_id};
  const BINDING_NAME = "__orgii_delta__";

  // Find the composer's outermost container. Cursor renders each
  // composer bubble inside a `[data-composer-id]` attribute element.
  // We wait up to 5 s for it to appear (the response bubble may not
  // exist yet when we inject).
  function findContainer() {{
    return document.querySelector('[data-composer-id="' + COMPOSER_ID + '"]');
  }}

  let container = findContainer();
  if (!container) {{
    await new Promise((resolve) => {{
      let waited = 0;
      const id = setInterval(() => {{
        container = findContainer();
        waited += 200;
        if (container || waited >= 5000) {{ clearInterval(id); resolve(); }}
      }}, 200);
    }});
  }}

  if (!container) {{
    // This Page does not own the target composer — signal the caller
    // so it can try the next Page (multi-window probe scenario).
    return {{ ok: false, composerId: COMPOSER_ID, reason: "composer_not_in_dom" }};
  }}

  // Track the visible text length of the last assistant bubble so we
  // only emit the newly-appended delta, not the full accumulated text.
  let lastSeenLength = 0;

  // Helper: return the last assistant-response text node's content.
  function getLastAssistantText() {{
    // Cursor renders assistant bubbles inside elements with a role or
    // class that identifies them as AI output. We use a broad selector
    // and take the last matching element to get the in-progress bubble.
    const bubbles = container.querySelectorAll(
      '[class*="markdown"], [class*="assistant"], [class*="ai-message"], [class*="bot-message"]'
    );
    if (bubbles.length === 0) return "";
    return bubbles[bubbles.length - 1].textContent || "";
  }}

  const observer = new MutationObserver(() => {{
    const text = getLastAssistantText();
    if (text.length > lastSeenLength) {{
      const delta = text.slice(lastSeenLength);
      lastSeenLength = text.length;
      if (delta.length > 0) {{
        window[BINDING_NAME](JSON.stringify({{ session_id: SESSION_ID, text: delta }}));
      }}
    }}
  }});

  observer.observe(container, {{ childList: true, subtree: true, characterData: true }});

  return {{ ok: true, composerId: COMPOSER_ID }};
}})()
"#,
        session_id = session_id_js,
        composer_id = composer_id_js,
    );

    match client.evaluate(&expression).await? {
        Ok(result) => {
            // Check whether the JS side found the composer in this window.
            // `ok: false` means this Page does not own the target composer
            // (multi-window: wrong Cursor window). Treat it as an error so
            // the caller can try the next Page target.
            let ok = result
                .value
                .as_ref()
                .and_then(|v| v.get("ok"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if !ok {
                return Err(CdpError::ProtocolError {
                    code: 0,
                    message: format!("composer {composer_id} not found in this Page's DOM"),
                });
            }
            info!(
                composer_id,
                session_id, "injected delta observer for composer"
            );
        }
        Err(ex) => {
            return Err(CdpError::ProtocolError {
                code: 0,
                message: format!(
                    "inject_delta_observer eval threw: {} ({})",
                    ex.text,
                    ex.exception
                        .as_ref()
                        .and_then(|e| e.description.clone())
                        .unwrap_or_default()
                ),
            });
        }
    }

    Ok(client.on_event("Runtime.bindingCalled"))
}
