use super::*;

#[test]
fn init_tracing_is_idempotent() {
    // Second call must not panic — the desktop embedding will install
    // its own subscriber first, then call `run`.
    init_tracing("info");
    init_tracing("debug");
}
