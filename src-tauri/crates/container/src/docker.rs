use bollard::errors::Error as BollardError;
use bollard::models::{ContainerInspectResponse, ContainerSummary as DockerContainerSummary};
use bollard::query_parameters::ListContainersOptions;
use bollard::Docker;
use serde::Deserialize;
use serde_json::Value;
use tokio::process::Command;

use crate::types::{
    ContainerComposeInfo, ContainerEngineCandidate, ContainerEngineKind, ContainerEngineStatus,
    ContainerInspect, ContainerMount, ContainerPort, ContainerState, ContainerSummary,
    COMPOSE_PROJECT_LABEL, COMPOSE_SERVICE_LABEL, COMPOSE_WORKING_DIR_LABEL,
};

const LOCAL_ENGINE_ID: &str = "local";
const LOCAL_DOCKER_UNAVAILABLE_MESSAGE: &str =
    "Cannot reach the local Docker daemon. Is Docker Desktop, Colima, or Rancher Desktop running?";

pub fn map_docker_error(error: BollardError) -> String {
    let raw_message = error.to_string();
    let lower_message = raw_message.to_lowercase();
    if lower_message.contains("connection refused")
        || lower_message.contains("no such file")
        || lower_message.contains("not found") && lower_message.contains("docker")
        || lower_message.contains("cannot connect")
    {
        return LOCAL_DOCKER_UNAVAILABLE_MESSAGE.to_string();
    }
    raw_message
}

fn local_docker() -> Result<Docker, String> {
    Docker::connect_with_local_defaults().map_err(map_docker_error)
}

pub async fn ping_local_engine() -> ContainerEngineStatus {
    let docker = match local_docker() {
        Ok(client) => client,
        Err(error) => return unavailable_status(error),
    };

    match docker.version().await {
        Ok(version) => {
            let info = docker.info().await.ok();
            ContainerEngineStatus {
                available: true,
                engine_id: LOCAL_ENGINE_ID.to_string(),
                server_version: version.version,
                api_version: version.api_version,
                operating_system: info
                    .as_ref()
                    .and_then(|value| value.operating_system.clone()),
                architecture: info.as_ref().and_then(|value| value.architecture.clone()),
                error: None,
            }
        }
        Err(error) => unavailable_status(map_docker_error(error)),
    }
}

fn unavailable_status(error: String) -> ContainerEngineStatus {
    ContainerEngineStatus {
        available: false,
        engine_id: LOCAL_ENGINE_ID.to_string(),
        server_version: None,
        api_version: None,
        operating_system: None,
        architecture: None,
        error: Some(error),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct DockerContextRow {
    current: bool,
    description: String,
    docker_endpoint: String,
    error: String,
    name: String,
}

pub async fn list_engine_candidates() -> Result<Vec<ContainerEngineCandidate>, String> {
    let mut cmd = Command::new("docker");
    cmd.args(["context", "ls", "--format", "{{json .}}"]);
    // Suppress console window on Windows.
    #[cfg(windows)]
    cmd.creation_flags(app_platform::CREATE_NO_WINDOW);
    let output = cmd
        .output()
        .await
        .map_err(|error| format!("Failed to run docker context ls: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().filter_map(parse_context_row).collect())
}

fn parse_context_row(line: &str) -> Option<ContainerEngineCandidate> {
    let row: DockerContextRow = serde_json::from_str(line).ok()?;
    let kind = classify_engine_kind(&row.docker_endpoint, &row.description, &row.name);
    Some(ContainerEngineCandidate {
        id: row.name.clone(),
        kind,
        label: row.name,
        current: row.current,
        available: row.error.trim().is_empty(),
        endpoint: (!row.docker_endpoint.trim().is_empty()).then_some(row.docker_endpoint),
        detail: if row.error.trim().is_empty() {
            (!row.description.trim().is_empty()).then_some(row.description)
        } else {
            Some(row.error)
        },
    })
}

fn classify_engine_kind(endpoint: &str, description: &str, name: &str) -> ContainerEngineKind {
    let haystack = format!("{endpoint} {description} {name}").to_lowercase();
    if haystack.contains("ssh://") {
        return ContainerEngineKind::Ssh;
    }
    if haystack.contains("wsl") {
        return ContainerEngineKind::Wsl;
    }
    ContainerEngineKind::Local
}

pub async fn list_local_containers() -> Result<Vec<ContainerSummary>, String> {
    let docker = local_docker()?;
    let options = ListContainersOptions {
        all: true,
        ..Default::default()
    };
    let containers = docker
        .list_containers(Some(options))
        .await
        .map_err(map_docker_error)?;
    Ok(containers.iter().map(map_container_summary).collect())
}

pub async fn inspect_local_container(container_id: String) -> Result<ContainerInspect, String> {
    let docker = local_docker()?;
    let inspect = docker
        .inspect_container(&container_id, None)
        .await
        .map_err(map_docker_error)?;
    Ok(map_container_inspect(inspect))
}

pub async fn start_local_container(container_id: String) -> Result<(), String> {
    let docker = local_docker()?;
    docker
        .start_container(&container_id, None)
        .await
        .map_err(map_docker_error)
}

pub async fn stop_local_container(container_id: String) -> Result<(), String> {
    let docker = local_docker()?;
    docker
        .stop_container(&container_id, None)
        .await
        .map_err(map_docker_error)
}

pub async fn restart_local_container(container_id: String) -> Result<(), String> {
    let docker = local_docker()?;
    docker
        .restart_container(&container_id, None)
        .await
        .map_err(map_docker_error)
}

pub fn map_container_summary(container: &DockerContainerSummary) -> ContainerSummary {
    let id = container.id.clone().unwrap_or_default();
    let names: Vec<String> = container
        .names
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|name| name.trim_start_matches('/').to_string())
        .filter(|name| !name.is_empty())
        .collect();
    let display_name = names
        .first()
        .cloned()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| short_container_id(&id));
    let labels = container.labels.clone().unwrap_or_default();

    ContainerSummary {
        short_id: short_container_id(&id),
        id,
        names,
        display_name,
        image: container.image.clone(),
        image_id: container.image_id.clone(),
        command: container.command.clone(),
        created_at: container.created,
        state: ContainerState::from_docker_state(
            container.state.as_ref().map(|state| state.as_ref()),
        ),
        status: container.status.clone(),
        ports: container
            .ports
            .as_ref()
            .map(|ports| {
                ports
                    .iter()
                    .map(|port| ContainerPort {
                        private_port: port.private_port,
                        public_port: port.public_port,
                        protocol: port.typ.map(|protocol| protocol.as_ref().to_string()),
                        ip: port.ip.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        mounts: container
            .mounts
            .as_ref()
            .map(|mounts| {
                mounts
                    .iter()
                    .map(|mount| ContainerMount {
                        source: mount.source.clone(),
                        destination: mount.destination.clone(),
                        mode: mount.mode.clone(),
                        writable: mount.rw,
                        mount_type: mount.typ.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        compose: compose_info_from_labels(&labels),
        labels,
    }
}

fn map_container_inspect(inspect: ContainerInspectResponse) -> ContainerInspect {
    let raw = serde_json::to_value(&inspect).unwrap_or(Value::Null);
    let labels = inspect
        .config
        .as_ref()
        .and_then(|config| config.labels.clone())
        .unwrap_or_default();
    let id = inspect.id.clone().unwrap_or_default();
    let name = inspect
        .name
        .clone()
        .unwrap_or_default()
        .trim_start_matches('/')
        .to_string();
    let names = if name.is_empty() {
        Vec::new()
    } else {
        vec![name.clone()]
    };
    let state = inspect
        .state
        .as_ref()
        .and_then(|state| state.status)
        .map(|status| status.as_ref().to_string());
    let summary = ContainerSummary {
        short_id: short_container_id(&id),
        id,
        names,
        display_name: if name.is_empty() {
            short_container_id(inspect.id.as_deref().unwrap_or_default())
        } else {
            name
        },
        image: inspect
            .config
            .as_ref()
            .and_then(|config| config.image.clone())
            .or_else(|| inspect.image.clone()),
        image_id: inspect.image.clone(),
        command: inspect
            .config
            .as_ref()
            .and_then(|config| config.cmd.clone())
            .map(|cmd| cmd.join(" ")),
        created_at: None,
        state: ContainerState::from_docker_state(state.as_deref()),
        status: state,
        ports: Vec::new(),
        mounts: inspect
            .mounts
            .as_ref()
            .map(|mounts| {
                mounts
                    .iter()
                    .map(|mount| ContainerMount {
                        source: mount.source.clone(),
                        destination: mount.destination.clone(),
                        mode: mount.mode.clone(),
                        writable: mount.rw,
                        mount_type: mount.typ.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        compose: compose_info_from_labels(&labels),
        labels,
    };

    ContainerInspect {
        summary,
        started_at: inspect
            .state
            .as_ref()
            .and_then(|state| state.started_at.clone()),
        finished_at: inspect
            .state
            .as_ref()
            .and_then(|state| state.finished_at.clone()),
        restart_count: inspect.restart_count,
        working_dir: inspect
            .config
            .as_ref()
            .and_then(|config| config.working_dir.clone()),
        entrypoint: inspect
            .config
            .as_ref()
            .and_then(|config| config.entrypoint.clone()),
        environment: inspect
            .config
            .as_ref()
            .and_then(|config| config.env.clone())
            .unwrap_or_default(),
        raw,
    }
}

pub fn compose_info_from_labels(
    labels: &std::collections::HashMap<String, String>,
) -> ContainerComposeInfo {
    ContainerComposeInfo {
        project: labels.get(COMPOSE_PROJECT_LABEL).cloned(),
        service: labels.get(COMPOSE_SERVICE_LABEL).cloned(),
        working_dir: labels.get(COMPOSE_WORKING_DIR_LABEL).cloned(),
    }
}

fn short_container_id(id: &str) -> String {
    id.chars().take(12).collect()
}

#[cfg(test)]
#[path = "docker_tests.rs"]
mod tests;
