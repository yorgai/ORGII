//! Gemini Code Assist native provider.
//!
//! Speaks Google Code Assist's internal `generateContent` envelope using
//! Gemini OAuth accounts managed by the key vault.

pub mod client;
mod request;
mod response;

pub use client::GeminiNativeClient;
