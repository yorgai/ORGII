use super::*;

#[test]
fn maps_known_container_states() {
    assert_eq!(
        ContainerState::from_docker_state(Some("running")),
        ContainerState::Running
    );
    assert_eq!(
        ContainerState::from_docker_state(Some("exited")),
        ContainerState::Exited
    );
    assert_eq!(
        ContainerState::from_docker_state(Some("unexpected")),
        ContainerState::Unknown
    );
    assert_eq!(
        ContainerState::from_docker_state(None),
        ContainerState::Unknown
    );
}
