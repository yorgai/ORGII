//! Singleton supervisor for [`MobileRemoteBridge`].
//!
//! `MobileRemoteBridge::start` is non-blocking and spawns the
//! connect-with-reconnect loop on tokio. The supervisor owns the
//! single live bridge (if any) and serializes lifecycle calls
//! (`start` / `stop` / `restart`) under a mutex so two concurrent
//! Settings actions can never spawn two bridges side by side.
//!
//! ## Why a `OnceLock` singleton?
//!
//! Three layers want to drive the bridge:
//!
//!   * `lib.rs::run` calls [`BridgeSupervisor::set_host_factory`] and
//!     [`BridgeSupervisor::start`] on `setup`, *keeping* the
//!     supervisor alive for the rest of the process.
//!   * Settings `#[tauri::command]`s
//!     (`mobile_remote_set_relay_url`, `mobile_remote_pair_complete`,
//!     `mobile_remote_revoke_device`) call
//!     [`BridgeSupervisor::restart`] when their persisted state
//!     changes, since the bridge caches the relay URL and the
//!     paired-devices tier map at start time.
//!   * Tests use [`BridgeSupervisor::new_for_test`] for a fresh
//!     instance (the global isn't reset between cargo-test
//!     iterations).
//!
//! All three would otherwise pass an [`AppHandle`] and a host-factory
//! closure around to thread the production `DispatchHost` impl into
//! the bridge — that's tedious for the Tauri-command callers
//! (`pairing/commands.rs`) and brittle (forget once and you spawn
//! two bridges). The `OnceLock` singleton + factory-stash is simpler
//! and faithful to the actual semantics: there is exactly one bridge
//! per process, and exactly one production `DispatchHost` factory
//! installed by `app::lib.rs::run` before any other code runs.

use std::sync::{Arc, OnceLock};

use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::bridge::MobileRemoteBridge;
use crate::dispatch::DispatchHost;
use crate::error::MobileRemoteError;

/// Factory closure stored on the supervisor that builds a fresh
/// `DispatchHost` each time the bridge (re)starts. Stored as a `dyn`
/// closure so the `app` crate can hand in a `TauriDispatchHost`
/// constructor while this crate stays a pure leaf.
type HostFactory =
    Arc<dyn Fn() -> Arc<dyn DispatchHost + Send + Sync + 'static> + Send + Sync + 'static>;

/// Global singleton instance.
static SUPERVISOR: OnceLock<BridgeSupervisor> = OnceLock::new();

/// Owns the live [`MobileRemoteBridge`] (if any) and serializes
/// start / stop / restart calls so two concurrent Settings actions
/// can never spawn two bridges side by side.
pub struct BridgeSupervisor {
    inner: Mutex<Option<MobileRemoteBridge>>,
    host_factory: Mutex<Option<HostFactory>>,
}

impl BridgeSupervisor {
    /// Get-or-init the process-wide supervisor. Cheap: every call
    /// after the first is an atomic load.
    pub fn global() -> &'static BridgeSupervisor {
        SUPERVISOR.get_or_init(|| BridgeSupervisor {
            inner: Mutex::new(None),
            host_factory: Mutex::new(None),
        })
    }

    /// Install the production `DispatchHost` factory. Called once on
    /// app boot from `app::lib.rs::run` *before* `start`. The factory
    /// is stored as a closure so each bridge restart gets a fresh
    /// host bound to the live `AppHandle`.
    ///
    /// Idempotent: re-installing replaces the previous factory. In
    /// production this only happens at boot; tests can use it to
    /// swap in a fake host.
    pub async fn set_host_factory<F>(&self, factory: F)
    where
        F: Fn() -> Arc<dyn DispatchHost + Send + Sync + 'static> + Send + Sync + 'static,
    {
        let mut slot = self.host_factory.lock().await;
        *slot = Some(Arc::new(factory));
    }

    /// Start the bridge if it isn't already running. No-op when a
    /// bridge is already live (avoids accidentally double-spawning
    /// from a re-entrant boot path).
    ///
    /// Propagates pairing-storage errors so the boot path can log
    /// them; relay-unreachable is *not* an error here — the
    /// reconnect loop owns that.
    ///
    /// Errors out if [`set_host_factory`] hasn't been called yet —
    /// this should never happen in production (boot order:
    /// factory then start) and would be a programming error.
    pub async fn start(&self) -> Result<(), MobileRemoteError> {
        let mut guard = self.inner.lock().await;
        if guard.as_ref().is_some_and(MobileRemoteBridge::is_running) {
            info!(
                target: "mobile_remote::supervisor",
                "start called but bridge is already running; no-op"
            );
            return Ok(());
        }

        let factory = self
            .host_factory
            .lock()
            .await
            .as_ref()
            .cloned()
            .ok_or_else(|| {
                MobileRemoteError::DispatchHandler(
                    "BridgeSupervisor::start called before set_host_factory".to_owned(),
                )
            })?;
        let host = factory();

        match MobileRemoteBridge::start(host).await? {
            Some(bridge) => {
                info!(target: "mobile_remote::supervisor", "bridge started");
                *guard = Some(bridge);
            }
            None => {
                info!(
                    target: "mobile_remote::supervisor",
                    "no paired devices; bridge inactive"
                );
                *guard = None;
            }
        }

        Ok(())
    }

    /// Stop the live bridge, if any. Idempotent.
    pub async fn stop(&self) {
        let mut guard = self.inner.lock().await;
        if let Some(bridge) = guard.take() {
            bridge.stop().await;
            info!(target: "mobile_remote::supervisor", "bridge stopped");
        }
    }

    /// Stop and re-start the bridge so it picks up a new relay URL
    /// or a fresh paired-devices file. Used by:
    ///
    ///   * [`mobile_remote_set_relay_url`] — URL changed.
    ///   * [`mobile_remote_pair_complete`] — first device paired
    ///     (bridge was inactive at boot because the file was empty).
    ///   * [`mobile_remote_revoke_device`] — tier map changed.
    ///
    /// Errors during the start half are logged at WARN and swallowed
    /// so the calling Tauri command still reports its own success
    /// (the URL *was* persisted; the bridge will retry on next
    /// app launch). The settings UI surfaces the persisted URL via
    /// `mobile_remote_get_relay_url`, so the user still sees their
    /// change took effect.
    pub async fn restart(&self) {
        self.stop().await;
        if let Err(err) = self.start().await {
            warn!(
                target: "mobile_remote::supervisor",
                ?err,
                "restart: start half failed; bridge will stay down until next trigger"
            );
        }
    }

    /// Whether a bridge is currently live with at least one running
    /// task. Used by tests.
    #[cfg(test)]
    pub async fn is_running(&self) -> bool {
        let guard = self.inner.lock().await;
        guard.as_ref().is_some_and(MobileRemoteBridge::is_running)
    }

    /// Test-only constructor: a fresh supervisor *not* attached to
    /// the global `OnceLock`, so each test gets its own clean state.
    /// The global instance is unobservable across tests because cargo
    /// runs them in the same process.
    #[cfg(test)]
    pub(crate) fn new_for_test() -> Self {
        Self {
            inner: Mutex::new(None),
            host_factory: Mutex::new(None),
        }
    }

    /// Test-only injection: install a bridge built from
    /// pre-spawned handles so `stop()` and `restart()` can be
    /// exercised without a Tauri runtime.
    #[cfg(test)]
    pub(crate) async fn install_bridge_for_test(&self, bridge: MobileRemoteBridge) {
        let mut guard = self.inner.lock().await;
        *guard = Some(bridge);
    }
}

#[cfg(test)]
#[path = "supervisor_tests.rs"]
mod supervisor_tests;
