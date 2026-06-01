use crate::docker;
use crate::types::{
    ContainerEngineCandidate, ContainerEngineStatus, ContainerInspect, ContainerSummary,
};

#[tauri::command]
pub async fn container_engine_ping() -> Result<ContainerEngineStatus, String> {
    Ok(docker::ping_local_engine().await)
}

#[tauri::command]
pub async fn container_engine_candidates() -> Result<Vec<ContainerEngineCandidate>, String> {
    docker::list_engine_candidates().await
}

#[tauri::command]
pub async fn container_list() -> Result<Vec<ContainerSummary>, String> {
    docker::list_local_containers().await
}

#[tauri::command]
pub async fn container_inspect(container_id: String) -> Result<ContainerInspect, String> {
    docker::inspect_local_container(container_id).await
}

#[tauri::command]
pub async fn container_start(container_id: String) -> Result<(), String> {
    docker::start_local_container(container_id).await
}

#[tauri::command]
pub async fn container_stop(container_id: String) -> Result<(), String> {
    docker::stop_local_container(container_id).await
}

#[tauri::command]
pub async fn container_restart(container_id: String) -> Result<(), String> {
    docker::restart_local_container(container_id).await
}
