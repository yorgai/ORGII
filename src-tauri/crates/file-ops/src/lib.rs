//! File-utility leaf: binary detection, gitignore filtering, directory tree.
//!
//! High-performance file utilities implemented in Rust:
//! - Binary file detection (byte-level analysis)
//! - Gitignore/path filtering (pattern matching)
//! - Directory tree listing
//!
//! These operations are called frequently from the frontend and benefit from
//! native performance vs JavaScript implementations.

mod commands;

pub use commands::*;

#[cfg(test)]
mod tests;
