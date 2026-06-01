use super::*;
use crate::types::{COMPOSE_PROJECT_LABEL, COMPOSE_SERVICE_LABEL, COMPOSE_WORKING_DIR_LABEL};
use std::collections::HashMap;

#[test]
fn extracts_compose_info_from_labels() {
    let labels = HashMap::from([
        (COMPOSE_PROJECT_LABEL.to_string(), "demo".to_string()),
        (COMPOSE_SERVICE_LABEL.to_string(), "web".to_string()),
        (
            COMPOSE_WORKING_DIR_LABEL.to_string(),
            "/Users/example/demo".to_string(),
        ),
    ]);

    let compose = compose_info_from_labels(&labels);

    assert_eq!(compose.project.as_deref(), Some("demo"));
    assert_eq!(compose.service.as_deref(), Some("web"));
    assert_eq!(compose.working_dir.as_deref(), Some("/Users/example/demo"));
}

#[test]
fn maps_unavailable_docker_errors_to_actionable_message() {
    let error = map_docker_error(bollard::errors::Error::IOError {
        err: std::io::Error::new(std::io::ErrorKind::NotFound, "docker socket not found"),
    });

    assert!(error.contains("Docker Desktop"));
    assert!(error.contains("Colima"));
    assert!(error.contains("Rancher"));
}

#[test]
fn parses_ssh_docker_context() {
    let candidate = parse_context_row(
        r#"{"Current":false,"Description":"Remote build host","DockerEndpoint":"ssh://deploy@example.com","Error":"","Name":"prod-ssh"}"#,
    )
    .expect("valid docker context row");

    assert_eq!(candidate.id, "prod-ssh");
    assert_eq!(candidate.kind, ContainerEngineKind::Ssh);
    assert!(!candidate.current);
    assert!(candidate.available);
    assert_eq!(
        candidate.endpoint.as_deref(),
        Some("ssh://deploy@example.com")
    );
    assert_eq!(candidate.detail.as_deref(), Some("Remote build host"));
}

#[test]
fn parses_wsl_docker_context_from_name() {
    let candidate = parse_context_row(
        r#"{"Current":true,"Description":"Docker in WSL distro","DockerEndpoint":"unix:///var/run/docker.sock","Error":"","Name":"ubuntu-wsl"}"#,
    )
    .expect("valid docker context row");

    assert_eq!(candidate.kind, ContainerEngineKind::Wsl);
    assert!(candidate.current);
    assert!(candidate.available);
}

#[test]
fn parses_local_docker_context() {
    let candidate = parse_context_row(
        r#"{"Current":true,"Description":"Docker Desktop","DockerEndpoint":"unix:///Users/example/.docker/run/docker.sock","Error":"","Name":"desktop-linux"}"#,
    )
    .expect("valid docker context row");

    assert_eq!(candidate.kind, ContainerEngineKind::Local);
    assert!(candidate.current);
    assert!(candidate.available);
}

#[test]
fn parses_context_error_as_unavailable_detail() {
    let candidate = parse_context_row(
        r#"{"Current":false,"Description":"Remote host","DockerEndpoint":"ssh://deploy@offline.example.com","Error":"connection failed","Name":"offline"}"#,
    )
    .expect("valid docker context row");

    assert_eq!(candidate.kind, ContainerEngineKind::Ssh);
    assert!(!candidate.available);
    assert_eq!(candidate.detail.as_deref(), Some("connection failed"));
}

#[test]
fn ignores_invalid_context_rows() {
    assert!(parse_context_row("not json").is_none());
}
