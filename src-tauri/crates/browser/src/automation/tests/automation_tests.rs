use crate::automation::AgentBrowserController;
use shared_state::browser_state::{
    find_available_port, is_port_available, DEFAULT_AGENT_BROWSER_PORT,
};

#[test]
fn new_controller_not_running() {
    let controller = AgentBrowserController::new();
    assert!(!controller.is_running());
    assert!(!controller.is_paused());
    assert_eq!(controller.port(), DEFAULT_AGENT_BROWSER_PORT);
}

#[test]
fn pause_resume_toggle() {
    let controller = AgentBrowserController::new();
    assert!(!controller.is_paused());

    controller.pause();
    assert!(controller.is_paused());

    controller.resume();
    assert!(!controller.is_paused());
}

#[test]
fn find_available_port_returns_some() {
    let port = find_available_port(49152);
    assert!(
        port.is_some(),
        "should find at least one open port in range 49152..49252"
    );
}

#[test]
fn is_port_available_detects_bound_port() {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind to ephemeral port");
    let bound_port = listener.local_addr().unwrap().port();

    assert!(
        !is_port_available(bound_port),
        "port {} should be unavailable while bound",
        bound_port
    );

    drop(listener);

    assert!(
        is_port_available(bound_port),
        "port {} should be available after listener is dropped",
        bound_port
    );
}
