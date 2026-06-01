//! Server boot + graceful shutdown.
//!
//! `run` is intentionally the only public entrypoint. The CLI binary
//! (`bin/main.rs`) uses it to serve a public or tunnel-fronted relay with
//! graceful Ctrl+C shutdown.

use std::sync::Arc;
use std::sync::Once;

use tokio::net::TcpListener;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::config::AppConfig;
use crate::error::RelayError;
use crate::hub::UserHubRegistry;
use crate::routes::build_router;
use crate::state::AppState;
use crate::storage::{SqliteStorage, Storage};

/// `tracing_subscriber::registry()` panics if installed twice in the
/// same process, so gate init behind a `Once` rather than assuming we own
/// the global subscriber.
static TRACING_INIT: Once = Once::new();

/// Boot the relay listener with graceful Ctrl+C shutdown wiring.
pub async fn run(config: AppConfig) -> Result<(), RelayError> {
    init_tracing(&config.log_level);

    let storage: Arc<dyn Storage> = Arc::new(SqliteStorage::open(&config.storage_path).await?);
    let hub_registry = Arc::new(UserHubRegistry::new());
    let state = AppState::new(storage, hub_registry);
    let router = build_router(state);

    let listener = TcpListener::bind(config.listen_addr).await?;
    let bound = listener.local_addr()?;
    tracing::info!(
        listen_addr = %bound,
        storage_path = %config.storage_path.display(),
        "orgii-mobile-relay listening",
    );

    axum::serve(listener, router)
        .with_graceful_shutdown(ctrl_c())
        .await
        .map_err(|err| RelayError::Server(err.to_string()))?;

    tracing::info!("orgii-mobile-relay shutdown complete");
    Ok(())
}

fn init_tracing(default_level: &str) {
    TRACING_INIT.call_once(|| {
        // `EnvFilter::try_from_default_env` consults `RUST_LOG`; we fall
        // back to the AppConfig level so users running via the binary
        // can override without setting an env var.
        let filter =
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(default_level));

        let registry = tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer());

        // If another consumer (e.g. the desktop app) already installed a
        // subscriber, swallow the error: there's nothing useful we can
        // do here, and panicking would crash the embedding host.
        let _ = registry.try_init();
    });
}

async fn ctrl_c() {
    if let Err(err) = tokio::signal::ctrl_c().await {
        tracing::error!(?err, "failed to install Ctrl+C handler");
    }
    tracing::info!("Ctrl+C received, beginning graceful shutdown");
}

#[cfg(test)]
#[path = "server_tests.rs"]
mod tests;
