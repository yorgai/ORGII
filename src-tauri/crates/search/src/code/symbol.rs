//! Symbol Module
//!
//! Defines symbols extracted from code files.

use super::text_range::TextRange;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Symbol {
    pub kind: String,
    pub range: TextRange,
}
