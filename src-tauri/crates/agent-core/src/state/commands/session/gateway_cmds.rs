//! Gateway lifecycle helpers.

use serde::{Deserialize, Serialize};

use crate::state::AgentAppState;

/// Gateway status information.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatus {
    pub running: bool,
    pub active_sessions: usize,
}

pub(super) async fn gateway_is_running_impl(state: &AgentAppState) -> Result<bool, String> {
    Ok(state.is_gateway_running())
}

pub(super) async fn gateway_start_impl(state: &AgentAppState) -> Result<(), String> {
    crate::state::commands::channel_handler::ensure_gateway_infra(state).await
}

pub(super) async fn gateway_stop_impl(state: &AgentAppState) -> Result<(), String> {
    state.gateway.stop().await;
    Ok(())
}

pub(super) async fn gateway_status_impl(state: &AgentAppState) -> Result<GatewayStatus, String> {
    let sessions = state.list_sessions().await;
    Ok(GatewayStatus {
        running: state.is_gateway_running(),
        active_sessions: sessions.len(),
    })
}
