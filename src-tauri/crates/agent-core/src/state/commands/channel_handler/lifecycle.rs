//! Channel infra lifecycle: process bootstrap, session init helper, and
//! the two `#[tauri::command]` surfaces that the frontend uses to toggle
//! channels and update the default channel-launch model.

use crate::state::AgentAppState;
use tracing::{error, info};

use super::dispatch::build_inbound_deps;

/// Start the channel inbound/outbound processors and hydrate the binding
/// cache from SQLite. Idempotent: returns early if the processors are
/// already running.
///
/// OS sessions are minted lazily on first inbound for each
/// `(channel, chat_id)`, so there is nothing model-specific to pre-warm.
///
/// `#[doc(hidden)]` — only reached by `app::api::agent::test::core` via
/// `agent_core::debug::ensure_gateway_infra`.
#[doc(hidden)]
pub async fn ensure_gateway_infra(state: &AgentAppState) -> Result<(), String> {
    if state.gateway.is_running() {
        return Ok(());
    }

    if let Err(err) = state.gateway_bindings.load_from_db().await {
        tracing::warn!("[gateway] Failed to hydrate binding store from db: {}", err);
    }

    let deps = build_inbound_deps(state)?;
    state.gateway.start(deps).await
}

pub async fn restore_enabled_channels(state: &AgentAppState) -> Result<(), String> {
    let channels = state.integrations.snapshot().channels.clone();

    if !channels.has_any_enabled() {
        info!("[gateway] No enabled channels in config — skipping restore");
        return Ok(());
    }

    ensure_gateway_infra(state).await?;

    state.gateway.restore_channels(&channels).await
}

#[tauri::command]
pub async fn agent_toggle_channel(
    state: tauri::State<'_, AgentAppState>,
    channel_type: String,
    account_id: String,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        if let Err(err) = ensure_gateway_infra(&state).await {
            let channel_name = if channel_type == "plugin" {
                account_id.clone()
            } else {
                format!("{}:{}", channel_type, account_id)
            };
            error!(
                "[gateway] Failed to start channel infra for {}: {}",
                channel_name, err
            );
            return Err(err);
        }
    }

    let channels = state.integrations.snapshot().channels.clone();

    state
        .gateway
        .toggle_channel(&channel_type, &account_id, enabled, &channels)
        .await
}

/// Channel session init: resolve definition from the registered session,
/// use `personal_workspace()` as the working directory, delegate to `init_session`.
pub(super) async fn init_channel_session(
    state: &AgentAppState,
    session_id: &str,
    account_id: Option<&str>,
    model_override: Option<&str>,
) -> Result<std::sync::Arc<crate::state::SessionRuntime>, String> {
    let launch_spec = crate::init::launch_spec::AgentLaunchSpec::registered_session(
        state,
        session_id,
        app_paths::personal_workspace(),
        account_id.map(str::to_string),
        model_override.map(str::to_string),
        None,
    )
    .await?;
    crate::init::init_session(state, launch_spec).await
}

/// Update the default model + account for channel-launched sessions.
///
/// Persists `channels.gateway.model` / `channels.gateway.accountId` via
/// `state.integrations`. Every per-chat OS session minted from inbound
/// traffic uses these as the default model override on first init; a
/// later `/model`-style command (TODO) will let users pick per channel.
///
/// Pass `None` for either field to clear it.
#[tauri::command]
pub async fn agent_set_gateway_model(
    state: tauri::State<'_, AgentAppState>,
    account_id: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    let model_clean = model.filter(|s| !s.is_empty());
    let account_clean = account_id.filter(|s| !s.is_empty());

    state
        .integrations
        .update(|cfg| {
            cfg.channels.gateway.model = model_clean.clone();
            cfg.channels.gateway.account_id = account_clean.clone();
            Ok::<(), std::convert::Infallible>(())
        })
        .map_err(|err| format!("failed to persist channel default model: {}", err))?;

    info!("[gateway] Updated channel default model/account binding");
    Ok(())
}
