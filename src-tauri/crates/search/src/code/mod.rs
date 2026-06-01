//! Code Search Module
//!
//! Provides code search functionality:
//! - Text/regex search (direct file scanning)
//! - Symbol extraction using Tree-sitter
//! - Go-to-definition and find-references

pub mod commands;
pub mod intelligence;
pub mod symbol;
pub mod text_range;
