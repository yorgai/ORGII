//! Transport adapters for different platforms

pub mod tauri;

#[cfg(test)]
pub mod mock;

pub use tauri::TauriTransportAdapter;

#[cfg(test)]
pub use mock::MockTransportAdapter;
