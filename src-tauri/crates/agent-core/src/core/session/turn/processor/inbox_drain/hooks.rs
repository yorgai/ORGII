//! `MemberShutdownHook` trait, process-wide `OnceLock`, test-override slot, and RAII guard.
//!
//! Separated from the main drain logic so unit tests can install stubs via
//! [`MemberShutdownHookGuard`] without pulling in the full drain pipeline.

use std::sync::{Arc, OnceLock};

pub trait MemberShutdownHook: Send + Sync {
    /// Cancel the worker session bound to `(member_id, org_run_id)`.
    /// Returns nothing — observed effects are tested via inbox state
    /// changes ([`AgentMessage::MemberTerminated`] persistence) rather
    /// than the hook's own behaviour.
    fn cancel_member_session(&self, member_id: &str, org_run_id: &str);

    /// Wake the coordinator after a shutdown side-effect writes a
    /// `MemberTerminated` row into the coordinator inbox.
    fn wake_coordinator(&self, _org_run_id: &str) {}
}

/// Hook stub for tests / contexts where there is no real session
/// runtime to cancel (pure rendering tests, the inbox-drain unit
/// suite). Never crashes; never side-effects.
pub struct NoopMemberShutdownHook;

impl MemberShutdownHook for NoopMemberShutdownHook {
    fn cancel_member_session(&self, _member_id: &str, _org_run_id: &str) {}
}

/// Process-wide shutdown hook installed by the boot path
/// (`agent_core::init::install_inbox_drain_member_shutdown_hook`).
///
/// Why a global instead of a parameter on the drain entry point:
/// `processor::process` does not have an `AgentAppState` borrow
/// available at the call site, and threading one through the
/// turn-processor pipeline solely for this hook would be a much
/// larger surface change than the protocol-level fix warrants. The
/// hook is installed exactly once at app boot and looked up at drain
/// time; tests substitute a stub via [`set_member_shutdown_hook_for_test`].
static MEMBER_SHUTDOWN_HOOK: OnceLock<Arc<dyn MemberShutdownHook>> = OnceLock::new();

/// Install the production [`MemberShutdownHook`] at app boot. Idempotent
/// after the first install (subsequent calls are a no-op so the test
/// hook setter remains safe to call from individual `#[test]` bodies
/// even after a prior test installed its own).
pub fn install_member_shutdown_hook(hook: Arc<dyn MemberShutdownHook>) {
    let _ = MEMBER_SHUTDOWN_HOOK.set(hook);
}

/// Resolve the active hook, falling back to the no-op hook if nothing
/// has been installed yet (early boot, headless / unit-test contexts).
pub(super) fn current_member_shutdown_hook() -> Arc<dyn MemberShutdownHook> {
    test_overrides::current()
        .or_else(|| MEMBER_SHUTDOWN_HOOK.get().cloned())
        .unwrap_or_else(|| Arc::new(NoopMemberShutdownHook) as Arc<dyn MemberShutdownHook>)
}

/// Test-only override slot. Lives in a sub-module so the production
/// `OnceLock` cannot accidentally observe a stub. Each test sets the
/// override at entry and clears it on drop via [`MemberShutdownHookGuard`].
mod test_overrides {
    use super::MemberShutdownHook;
    use std::sync::{Arc, RwLock};

    static TEST_HOOK: RwLock<Option<Arc<dyn MemberShutdownHook>>> = RwLock::new(None);

    pub fn current() -> Option<Arc<dyn MemberShutdownHook>> {
        TEST_HOOK
            .read()
            .ok()
            .and_then(|guard| guard.as_ref().cloned())
    }

    #[cfg(test)]
    pub fn set(hook: Arc<dyn MemberShutdownHook>) {
        if let Ok(mut guard) = TEST_HOOK.write() {
            *guard = Some(hook);
        }
    }

    #[cfg(test)]
    pub fn clear() {
        if let Ok(mut guard) = TEST_HOOK.write() {
            *guard = None;
        }
    }
}

/// RAII guard for tests: install a hook on construction and tear it
/// down on drop, so an in-test panic does not leave the global hook
/// dangling for the next test in the same process. Mirrors
/// `member_idle::MemberIdleHookGuard`.
#[cfg(test)]
pub struct MemberShutdownHookGuard;

#[cfg(test)]
impl MemberShutdownHookGuard {
    pub fn install(hook: Arc<dyn MemberShutdownHook>) -> Self {
        test_overrides::set(hook);
        Self
    }
}

#[cfg(test)]
impl Drop for MemberShutdownHookGuard {
    fn drop(&mut self) {
        test_overrides::clear();
    }
}
