//! Terminal Module
//!
//! PTY terminal management and shell detection.

pub mod pty;
pub mod shell_integration;
pub mod shells;

pub use pty::*;
