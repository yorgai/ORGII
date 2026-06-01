//! `orgii-mobile-relay` CLI entrypoint.
//!
//! All argument parsing, subcommand dispatch, and service-manager
//! integration lives in `orgii_mobile_relay::cli`. This file is a
//! deliberately thin wrapper: it exists only because Cargo wants a
//! binary target with a `main` function.

use std::process::ExitCode;

use orgii_mobile_relay::cli;

#[tokio::main]
async fn main() -> ExitCode {
    match cli::run_cli().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("orgii-mobile-relay: {err:#}");
            ExitCode::FAILURE
        }
    }
}
