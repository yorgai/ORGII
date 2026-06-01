//! Token Extractor
//!
//! Scans source files for CSS variable usage patterns to identify required design tokens.
//!
//! Supports patterns like:
//! - `var(--token-name)`
//! - `rgb(var(--token-name))`
//! - `rgba(var(--token-name), 0.5)`
//! - CSS-in-JS: `--token-name: value`

use regex::Regex;
use std::collections::HashSet;
use std::path::Path;

/// Result of token extraction
#[derive(Debug, Clone, serde::Serialize)]
pub struct TokenExtractionResult {
    /// List of unique token names found (without -- prefix)
    pub tokens: Vec<String>,
    /// Number of usages found
    pub usage_count: usize,
}

/// Extracts CSS variable tokens from source code
pub struct TokenExtractor {
    /// Regex to match var(--token-name)
    var_pattern: Regex,
    /// Regex to match --token-name in style objects
    css_var_pattern: Regex,
}

impl TokenExtractor {
    pub fn new() -> Self {
        Self {
            // Match var(--anything) including nested in rgb(), rgba(), etc.
            var_pattern: Regex::new(r"var\s*\(\s*--([a-zA-Z0-9_-]+)\s*\)").unwrap(),
            // Match --token-name: or "--token-name" in JS/TS
            css_var_pattern: Regex::new(r#"["']?--([a-zA-Z0-9_-]+)["']?\s*[:\)]"#).unwrap(),
        }
    }

    /// Extract tokens from a file
    pub fn extract_from_file(&self, path: &Path) -> Result<TokenExtractionResult, String> {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

        Ok(self.extract_from_content(&content))
    }

    /// Extract tokens from source content
    pub fn extract_from_content(&self, content: &str) -> TokenExtractionResult {
        let mut tokens = HashSet::new();
        let mut usage_count = 0;

        // Find all var(--name) patterns
        for cap in self.var_pattern.captures_iter(content) {
            if let Some(token_name) = cap.get(1) {
                tokens.insert(token_name.as_str().to_string());
                usage_count += 1;
            }
        }

        // Find --name patterns in style objects (e.g., "--hover-bg": value)
        for cap in self.css_var_pattern.captures_iter(content) {
            if let Some(token_name) = cap.get(1) {
                let name = token_name.as_str();
                // Skip if it looks like a custom property definition rather than usage
                // (we still want to capture it as a token that might be needed)
                tokens.insert(name.to_string());
                usage_count += 1;
            }
        }

        // Sort tokens for consistent output
        let mut tokens_vec: Vec<String> = tokens.into_iter().collect();
        tokens_vec.sort();

        TokenExtractionResult {
            tokens: tokens_vec,
            usage_count,
        }
    }

    /// Extract tokens from multiple files
    pub fn extract_from_files(&self, paths: &[&Path]) -> TokenExtractionResult {
        let mut all_tokens = HashSet::new();
        let mut total_usage = 0;

        for path in paths {
            if let Ok(result) = self.extract_from_file(path) {
                for token in result.tokens {
                    all_tokens.insert(token);
                }
                total_usage += result.usage_count;
            }
        }

        let mut tokens_vec: Vec<String> = all_tokens.into_iter().collect();
        tokens_vec.sort();

        TokenExtractionResult {
            tokens: tokens_vec,
            usage_count: total_usage,
        }
    }
}

impl Default for TokenExtractor {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================
// Token Definition Extraction (from CSS files)
// ============================================

/// A token definition with its value
#[derive(Debug, Clone, serde::Serialize)]
pub struct TokenDefinition {
    /// Token name (without -- prefix)
    pub name: String,
    /// Token value
    pub value: String,
    /// Source file path
    pub source: String,
}

/// Result of extracting token definitions
#[derive(Debug, Clone, serde::Serialize)]
pub struct TokenDefinitionsResult {
    /// List of token definitions
    pub tokens: Vec<TokenDefinition>,
}

/// Extracts CSS variable definitions from CSS files
pub struct TokenDefinitionExtractor {
    /// Regex to match --name: value patterns
    css_var_def: Regex,
}

impl TokenDefinitionExtractor {
    pub fn new() -> Self {
        Self {
            // Match CSS variable definitions: --name: value;
            // Captures: 1=name, 2=value
            css_var_def: Regex::new(r"--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);").unwrap(),
        }
    }

    /// Extract token definitions from a CSS file
    pub fn extract_from_file(&self, path: &Path) -> Result<Vec<TokenDefinition>, String> {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

        let source = path.to_string_lossy().to_string();
        Ok(self.extract_from_content(&content, &source))
    }

    /// Extract token definitions from CSS content
    pub fn extract_from_content(&self, content: &str, source: &str) -> Vec<TokenDefinition> {
        let mut tokens = Vec::new();

        for cap in self.css_var_def.captures_iter(content) {
            if let (Some(name), Some(value)) = (cap.get(1), cap.get(2)) {
                tokens.push(TokenDefinition {
                    name: name.as_str().to_string(),
                    value: value.as_str().trim().to_string(),
                    source: source.to_string(),
                });
            }
        }

        tokens
    }

    /// Scan a directory for CSS files and extract all token definitions
    pub fn scan_directory(&self, dir: &Path, max_depth: usize) -> TokenDefinitionsResult {
        let mut all_tokens = Vec::new();
        self.scan_dir_recursive(dir, 0, max_depth, &mut all_tokens);

        // Remove duplicates (keep first occurrence)
        let mut seen = HashSet::new();
        all_tokens.retain(|t| seen.insert(t.name.clone()));

        TokenDefinitionsResult { tokens: all_tokens }
    }

    fn scan_dir_recursive(
        &self,
        dir: &Path,
        depth: usize,
        max_depth: usize,
        tokens: &mut Vec<TokenDefinition>,
    ) {
        if depth > max_depth {
            return;
        }

        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                // Skip common non-source directories
                if !matches!(name, "node_modules" | ".git" | "dist" | "build" | "target") {
                    self.scan_dir_recursive(&path, depth + 1, max_depth, tokens);
                }
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                // Only process CSS and SCSS files
                if matches!(ext, "css" | "scss") {
                    if let Ok(file_tokens) = self.extract_from_file(&path) {
                        tokens.extend(file_tokens);
                    }
                }
            }
        }
    }
}

impl Default for TokenDefinitionExtractor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "tests/token_extractor_tests.rs"]
mod tests;
