//! Story Extractor for .orgii.tsx files
//!
//! Parses ORGII story files and extracts:
//! - Meta configuration (component, title, default args)
//! - Individual stories (name, args, description)
//!
//! Uses tree-sitter for TypeScript/TSX parsing.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Extracted story metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryInfo {
    /// Export name (e.g., "Primary")
    pub export_name: String,
    /// Display name (from story.name or export name)
    pub name: String,
    /// Args extracted from story definition
    pub args: serde_json::Value,
    /// Story description
    pub description: Option<String>,
    /// Tags
    pub tags: Vec<String>,
    /// Line number in source file
    pub line: u32,
}

/// Extracted meta configuration from default export
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryMeta {
    /// Component import/reference
    pub component: String,
    /// Navigation title (e.g., "Components/Button")
    pub title: String,
    /// Default args
    pub default_args: serde_json::Value,
    /// Description
    pub description: Option<String>,
    /// Tags
    pub tags: Vec<String>,
}

/// Full story file extraction result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryFileInfo {
    /// Absolute file path
    pub file: String,
    /// Meta configuration
    pub meta: StoryMeta,
    /// Individual stories
    pub stories: Vec<StoryInfo>,
}

/// Story extractor using tree-sitter
pub struct StoryExtractor {
    parser: tree_sitter::Parser,
}

// Same pattern as `PropsExtractor`: tree-sitter walk helpers take `&self`
// for symmetry with sibling helpers, even when only one call site recurses.
#[allow(clippy::only_used_in_recursion)]
impl StoryExtractor {
    /// Create a new story extractor
    pub fn new() -> Result<Self, String> {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&tree_sitter_typescript::LANGUAGE_TSX.into())
            .map_err(|e| format!("Failed to set TSX language: {}", e))?;

        Ok(Self { parser })
    }

    /// Check if a file is a story file
    pub fn is_story_file(path: &Path) -> bool {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        name.ends_with(".orgii.tsx") || name.ends_with(".orgii.ts")
    }

    /// Extract stories from a file
    pub fn extract_stories(&mut self, path: &Path, content: &str) -> Result<StoryFileInfo, String> {
        let tree = self
            .parser
            .parse(content, None)
            .ok_or_else(|| "Failed to parse file".to_string())?;

        let root = tree.root_node();
        let source = content.as_bytes();

        // Extract meta from default export
        let meta = self.extract_meta(root, source)?;

        // Extract individual stories from named exports
        let stories = self.extract_stories_from_exports(root, source);

        Ok(StoryFileInfo {
            file: path.to_string_lossy().to_string(),
            meta,
            stories,
        })
    }

    /// Extract meta configuration from default export
    fn extract_meta(&self, root: tree_sitter::Node, source: &[u8]) -> Result<StoryMeta, String> {
        let mut meta = StoryMeta {
            component: String::new(),
            title: String::new(),
            default_args: serde_json::json!({}),
            description: None,
            tags: vec![],
        };

        // Find: export default { ... }
        // or: const meta = { ... }; export default meta;
        let mut cursor = root.walk();

        for child in root.children(&mut cursor) {
            // Look for export_statement with default
            if child.kind() == "export_statement" {
                let child_text = self.node_text(child, source);

                if child_text.contains("export default") {
                    // Find the object in the export
                    if let Some(obj) = self.find_child_by_kind(child, "object") {
                        self.extract_meta_from_object(obj, source, &mut meta);
                    }
                }
            }

            // Also look for: const meta: OrgiiMeta = { ... }
            if child.kind() == "lexical_declaration" {
                let child_text = self.node_text(child, source);
                if child_text.contains("OrgiiMeta") || child_text.contains(": OrgiiMeta") {
                    if let Some(obj) = self.find_child_by_kind(child, "object") {
                        self.extract_meta_from_object(obj, source, &mut meta);
                    }
                }
            }
        }

        if meta.component.is_empty() && meta.title.is_empty() {
            return Err("No meta configuration found".to_string());
        }

        Ok(meta)
    }

    /// Extract meta fields from object literal
    fn extract_meta_from_object(
        &self,
        obj: tree_sitter::Node,
        source: &[u8],
        meta: &mut StoryMeta,
    ) {
        let mut cursor = obj.walk();

        for child in obj.children(&mut cursor) {
            if child.kind() == "pair" || child.kind() == "property_signature" {
                let key = self.get_pair_key(child, source);
                let value = self.get_pair_value(child, source);

                match key.as_str() {
                    "component" => meta.component = value,
                    "title" => meta.title = self.unquote(&value),
                    "description" => meta.description = Some(self.unquote(&value)),
                    "args" => {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&value) {
                            meta.default_args = parsed;
                        }
                    }
                    "tags" => {
                        meta.tags = self.extract_string_array(child, source);
                    }
                    _ => {}
                }
            }
        }
    }

    /// Extract stories from named exports
    fn extract_stories_from_exports(
        &self,
        root: tree_sitter::Node,
        source: &[u8],
    ) -> Vec<StoryInfo> {
        let mut stories = Vec::new();
        let mut cursor = root.walk();

        for child in root.children(&mut cursor) {
            // Look for: export const Primary: OrgiiStory = { ... }
            if child.kind() == "export_statement" {
                let child_text = self.node_text(child, source);

                // Skip default export
                if child_text.contains("export default") {
                    continue;
                }

                // Find variable declarator
                if let Some(decl) = self.find_child_by_kind(child, "lexical_declaration") {
                    if let Some(declarator) = self.find_child_by_kind(decl, "variable_declarator") {
                        if let Some(story) = self.extract_story_from_declarator(declarator, source)
                        {
                            stories.push(story);
                        }
                    }
                }
            }
        }

        stories
    }

    /// Extract a single story from a variable declarator
    fn extract_story_from_declarator(
        &self,
        declarator: tree_sitter::Node,
        source: &[u8],
    ) -> Option<StoryInfo> {
        // Get the name (identifier)
        let name_node = declarator.child_by_field_name("name")?;
        let export_name = self.node_text(name_node, source);

        // Skip if it looks like meta
        if export_name == "meta" || export_name == "default" {
            return None;
        }

        // Get the value (should be an object)
        let value_node = declarator.child_by_field_name("value")?;

        // Must be an object to be a story
        if value_node.kind() != "object" {
            return None;
        }

        let mut story = StoryInfo {
            export_name: export_name.clone(),
            name: export_name.clone(),
            args: serde_json::json!({}),
            description: None,
            tags: vec![],
            line: declarator.start_position().row as u32 + 1,
        };

        // Extract story properties
        let mut cursor = value_node.walk();
        for child in value_node.children(&mut cursor) {
            if child.kind() == "pair" {
                let key = self.get_pair_key(child, source);
                let value = self.get_pair_value(child, source);

                match key.as_str() {
                    "name" => story.name = self.unquote(&value),
                    "description" => story.description = Some(self.unquote(&value)),
                    "args" => {
                        // Try to parse args as JSON
                        if let Some(args_obj) = self.find_child_by_kind(child, "object") {
                            story.args = self.object_to_json(args_obj, source);
                        }
                    }
                    "tags" => {
                        story.tags = self.extract_string_array(child, source);
                    }
                    _ => {}
                }
            }
        }

        Some(story)
    }

    /// Convert an object node to JSON value
    fn object_to_json(&self, obj: tree_sitter::Node, source: &[u8]) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        let mut cursor = obj.walk();

        for child in obj.children(&mut cursor) {
            if child.kind() == "pair" {
                let key = self.get_pair_key(child, source);
                let value_node = child.child_by_field_name("value");

                if let Some(value_node) = value_node {
                    let value = self.node_to_json(value_node, source);
                    map.insert(key, value);
                }
            }
        }

        serde_json::Value::Object(map)
    }

    /// Convert a node to JSON value
    fn node_to_json(&self, node: tree_sitter::Node, source: &[u8]) -> serde_json::Value {
        match node.kind() {
            "string" | "template_string" => {
                let text = self.node_text(node, source);
                serde_json::Value::String(self.unquote(&text))
            }
            "number" => {
                let text = self.node_text(node, source);
                if let Ok(n) = text.parse::<i64>() {
                    serde_json::Value::Number(n.into())
                } else if let Ok(n) = text.parse::<f64>() {
                    serde_json::json!(n)
                } else {
                    serde_json::Value::String(text)
                }
            }
            "true" => serde_json::Value::Bool(true),
            "false" => serde_json::Value::Bool(false),
            "null" => serde_json::Value::Null,
            "object" => self.object_to_json(node, source),
            "array" => {
                let mut arr = Vec::new();
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() != "," && child.kind() != "[" && child.kind() != "]" {
                        arr.push(self.node_to_json(child, source));
                    }
                }
                serde_json::Value::Array(arr)
            }
            // For JSX, React nodes, functions, etc. - store as string representation
            _ => {
                let text = self.node_text(node, source);
                if text.starts_with('<') {
                    // JSX element - store type info
                    serde_json::json!({ "__jsx__": text })
                } else {
                    serde_json::Value::String(text)
                }
            }
        }
    }

    /// Extract string array from a pair node (for tags)
    fn extract_string_array(&self, pair: tree_sitter::Node, source: &[u8]) -> Vec<String> {
        let mut result = Vec::new();

        if let Some(arr) = self.find_child_by_kind(pair, "array") {
            let mut cursor = arr.walk();
            for child in arr.children(&mut cursor) {
                if child.kind() == "string" {
                    result.push(self.unquote(&self.node_text(child, source)));
                }
            }
        }

        result
    }

    /// Get the key from a pair node
    fn get_pair_key(&self, pair: tree_sitter::Node, source: &[u8]) -> String {
        if let Some(key) = pair.child_by_field_name("key") {
            return self.node_text(key, source);
        }
        // Fallback: first child
        if let Some(first) = pair.child(0) {
            return self.node_text(first, source);
        }
        String::new()
    }

    /// Get the value text from a pair node
    fn get_pair_value(&self, pair: tree_sitter::Node, source: &[u8]) -> String {
        if let Some(value) = pair.child_by_field_name("value") {
            return self.node_text(value, source);
        }
        // Fallback: child after colon
        let mut found_colon = false;
        let mut cursor = pair.walk();
        for child in pair.children(&mut cursor) {
            if child.kind() == ":" {
                found_colon = true;
            } else if found_colon {
                return self.node_text(child, source);
            }
        }
        String::new()
    }

    /// Find a child node by kind (recursive)
    fn find_child_by_kind<'a>(
        &self,
        node: tree_sitter::Node<'a>,
        kind: &str,
    ) -> Option<tree_sitter::Node<'a>> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == kind {
                return Some(child);
            }
            if let Some(found) = self.find_child_by_kind(child, kind) {
                return Some(found);
            }
        }
        None
    }

    /// Get text content of a node
    fn node_text(&self, node: tree_sitter::Node, source: &[u8]) -> String {
        node.utf8_text(source).unwrap_or("").to_string()
    }

    /// Remove quotes from a string
    fn unquote(&self, s: &str) -> String {
        let s = s.trim();
        if (s.starts_with('"') && s.ends_with('"'))
            || (s.starts_with('\'') && s.ends_with('\''))
            || (s.starts_with('`') && s.ends_with('`'))
        {
            s[1..s.len() - 1].to_string()
        } else {
            s.to_string()
        }
    }
}

impl Default for StoryExtractor {
    fn default() -> Self {
        Self::new().expect("Failed to create StoryExtractor")
    }
}

#[cfg(test)]
#[path = "tests/story_extractor_tests.rs"]
mod tests;
