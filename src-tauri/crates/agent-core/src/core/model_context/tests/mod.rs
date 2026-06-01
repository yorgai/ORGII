//! Tests for model_context module
//!
//! All tests for the model context components are organized here:
//! - tokenizer_tests: Token counting tests
//! - compaction_tests: Context compaction tests
//! - session_memory_tests: Session memory extraction & SM-compact tests
//! - file_reinjection_tests: Post-compact file re-injection tests

pub mod tokenizer_tests;
pub mod compaction_tests;
pub mod file_reinjection_tests;
pub mod session_memory_tests;