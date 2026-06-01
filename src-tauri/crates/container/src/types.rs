use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const COMPOSE_PROJECT_LABEL: &str = "com.docker.compose.project";
pub const COMPOSE_SERVICE_LABEL: &str = "com.docker.compose.service";
pub const COMPOSE_WORKING_DIR_LABEL: &str = "com.docker.compose.project.working_dir";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContainerEngineKind {
    Local,
    Ssh,
    Wsl,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainerEngineCandidate {
    pub id: String,
    pub kind: ContainerEngineKind,
    pub label: String,
    pub current: bool,
    pub available: bool,
    pub endpoint: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContainerState {
    Created,
    Running,
    Paused,
    Restarting,
    Exited,
    Removing,
    Dead,
    Stopping,
    Unknown,
}

impl ContainerState {
    pub fn from_docker_state(value: Option<&str>) -> Self {
        match value {
            Some("created") => Self::Created,
            Some("running") => Self::Running,
            Some("paused") => Self::Paused,
            Some("restarting") => Self::Restarting,
            Some("exited") => Self::Exited,
            Some("removing") => Self::Removing,
            Some("dead") => Self::Dead,
            Some("stopping") => Self::Stopping,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainerEngineStatus {
    pub available: bool,
    pub engine_id: String,
    pub server_version: Option<String>,
    pub api_version: Option<String>,
    pub operating_system: Option<String>,
    pub architecture: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainerPort {
    pub private_port: u16,
    pub public_port: Option<u16>,
    pub protocol: Option<String>,
    pub ip: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainerMount {
    pub source: Option<String>,
    pub destination: Option<String>,
    pub mode: Option<String>,
    pub writable: Option<bool>,
    pub mount_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainerComposeInfo {
    pub project: Option<String>,
    pub service: Option<String>,
    pub working_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainerSummary {
    pub id: String,
    pub short_id: String,
    pub names: Vec<String>,
    pub display_name: String,
    pub image: Option<String>,
    pub image_id: Option<String>,
    pub command: Option<String>,
    pub created_at: Option<i64>,
    pub state: ContainerState,
    pub status: Option<String>,
    pub ports: Vec<ContainerPort>,
    pub mounts: Vec<ContainerMount>,
    pub labels: HashMap<String, String>,
    pub compose: ContainerComposeInfo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContainerInspect {
    pub summary: ContainerSummary,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub restart_count: Option<i64>,
    pub working_dir: Option<String>,
    pub entrypoint: Option<Vec<String>>,
    pub environment: Vec<String>,
    pub raw: serde_json::Value,
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod tests;
