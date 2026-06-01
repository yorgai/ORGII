//! Props Extractor for TypeScript/TSX components
//!
//! Lazily extracts prop definitions from TypeScript interfaces and types.
//! Called on-demand when user selects a component (not during initial scan).
//!
//! ## Extraction Strategy
//!
//! 1. Find the component function/arrow definition
//! 2. Look for typed props parameter: `function Button(props: ButtonProps)`
//! 3. Find the corresponding interface/type definition
//! 4. Extract prop names, types, required status, and JSDoc
//!
//! ## Performance
//!
//! - Single file parse: ~10-50ms
//! - Results are cached by the frontend after first extraction

use std::path::Path;

use crate::types::{ComponentKind, PropInfo, PropType};

/// Props extractor using tree-sitter
pub struct PropsExtractor {
    parser: tree_sitter::Parser,
}

/// Result of props extraction
#[derive(Debug, Default)]
pub struct ExtractionResult {
    /// Extracted props
    pub props: Vec<PropInfo>,
    /// Name of the props interface/type if found
    pub props_type_name: Option<String>,
    /// Component JSDoc description
    pub description: Option<String>,
}

// Several private helpers in this impl walk a tree-sitter AST recursively and
// take `&self` purely so they can call sibling helpers on the same extractor.
// Clippy flags the `&self` as "only used in recursion", but threading the
// extractor explicitly through every call would just reintroduce the same
// parameter under a different name. Suppress at the impl level.
#[allow(clippy::only_used_in_recursion)]
impl PropsExtractor {
    /// Create a new props extractor
    pub fn new() -> Result<Self, String> {
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&tree_sitter_typescript::LANGUAGE_TSX.into())
            .map_err(|e| format!("Failed to set TSX language: {}", e))?;

        Ok(Self { parser })
    }

    /// Extract props for a component at a specific line
    pub fn extract_props(
        &mut self,
        _path: &Path,
        content: &str,
        component_name: &str,
        component_line: u32,
        component_kind: &ComponentKind,
    ) -> ExtractionResult {
        let mut result = ExtractionResult::default();

        let tree = match self.parser.parse(content, None) {
            Some(tree) => tree,
            None => return result,
        };

        let root = tree.root_node();
        let source = content.as_bytes();

        // Step 1: Find the component definition node
        let component_node =
            self.find_component_node(root, source, component_name, component_line, component_kind);

        let component_node = match component_node {
            Some(node) => node,
            None => {
                log::debug!(
                    "[PropsExtractor] Could not find component node for {} at line {}",
                    component_name,
                    component_line
                );
                return result;
            }
        };

        // Step 2: Extract JSDoc for the component
        result.description = self.extract_jsdoc_before(component_node, source);

        // Step 3: Find props type annotation
        let props_type_name = self.find_props_type_name(component_node, source);

        if let Some(ref type_name) = props_type_name {
            result.props_type_name = Some(type_name.clone());

            // Step 4: Find the interface/type definition
            if let Some(type_node) = self.find_type_definition(root, source, type_name) {
                result.props = self.extract_props_from_type(type_node, source);
            }
        }

        // Step 5: If no named type, try inline props
        if result.props.is_empty() {
            result.props = self.extract_inline_props(component_node, source);
        }

        result
    }

    /// Find the component definition node by name and line
    fn find_component_node<'a>(
        &self,
        root: tree_sitter::Node<'a>,
        source: &[u8],
        component_name: &str,
        component_line: u32,
        component_kind: &ComponentKind,
    ) -> Option<tree_sitter::Node<'a>> {
        let target_line = component_line.saturating_sub(1); // 0-indexed

        // Use a cursor to traverse efficiently
        let mut cursor = root.walk();
        self.find_node_recursive(
            &mut cursor,
            source,
            component_name,
            target_line,
            component_kind,
        )
    }

    fn find_node_recursive<'a>(
        &self,
        cursor: &mut tree_sitter::TreeCursor<'a>,
        source: &[u8],
        component_name: &str,
        target_line: u32,
        component_kind: &ComponentKind,
    ) -> Option<tree_sitter::Node<'a>> {
        loop {
            let node = cursor.node();
            let node_line = node.start_position().row as u32;

            // Check if this node matches our criteria
            if node_line == target_line
                || (node_line <= target_line && node.end_position().row as u32 >= target_line)
            {
                let matches = match (node.kind(), component_kind) {
                    ("function_declaration", ComponentKind::FunctionDef) => node
                        .child_by_field_name("name")
                        .map(|n| self.node_text(n, source) == component_name)
                        .unwrap_or(false),
                    ("lexical_declaration" | "variable_declaration", ComponentKind::ArrowDef) => {
                        self.find_variable_name(node, source)
                            .map(|n| n == component_name)
                            .unwrap_or(false)
                    }
                    ("class_declaration", ComponentKind::ClassDef) => node
                        .child_by_field_name("name")
                        .map(|n| self.node_text(n, source) == component_name)
                        .unwrap_or(false),
                    ("export_statement", _) => {
                        // Check inside export statement
                        if cursor.goto_first_child() {
                            let result = self.find_node_recursive(
                                cursor,
                                source,
                                component_name,
                                target_line,
                                component_kind,
                            );
                            cursor.goto_parent();
                            if result.is_some() {
                                return result;
                            }
                        }
                        false
                    }
                    _ => false,
                };

                if matches {
                    return Some(node);
                }
            }

            // Traverse children
            if cursor.goto_first_child() {
                if let Some(found) = self.find_node_recursive(
                    cursor,
                    source,
                    component_name,
                    target_line,
                    component_kind,
                ) {
                    return Some(found);
                }
                cursor.goto_parent();
            }

            // Move to next sibling
            if !cursor.goto_next_sibling() {
                break;
            }
        }

        None
    }

    /// Find variable name in a lexical declaration
    fn find_variable_name(&self, node: tree_sitter::Node, source: &[u8]) -> Option<String> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "variable_declarator" {
                if let Some(name_node) = child.child_by_field_name("name") {
                    return Some(self.node_text(name_node, source));
                }
            }
        }
        None
    }

    /// Extract JSDoc comment before a node
    fn extract_jsdoc_before(&self, node: tree_sitter::Node, source: &[u8]) -> Option<String> {
        // Look for comment node before this node
        let mut prev = node.prev_sibling();
        while let Some(sibling) = prev {
            if sibling.kind() == "comment" {
                let text = self.node_text(sibling, source);
                if text.starts_with("/**") {
                    return Some(self.parse_jsdoc_description(&text));
                }
            } else if sibling.kind() != "comment" {
                break;
            }
            prev = sibling.prev_sibling();
        }
        None
    }

    /// Parse JSDoc comment to extract description
    fn parse_jsdoc_description(&self, comment: &str) -> String {
        let lines: Vec<&str> = comment.lines().collect();
        let mut description = String::new();

        for line in lines {
            let trimmed = line
                .trim()
                .trim_start_matches("/**")
                .trim_start_matches("*/")
                .trim_start_matches('*')
                .trim();

            // Stop at @param, @returns, etc.
            if trimmed.starts_with('@') {
                break;
            }

            if !trimmed.is_empty() {
                if !description.is_empty() {
                    description.push(' ');
                }
                description.push_str(trimmed);
            }
        }

        description
    }

    /// Find the props type name from function parameters or generic type arguments
    fn find_props_type_name(&self, node: tree_sitter::Node, source: &[u8]) -> Option<String> {
        // First, check for forwardRef/memo patterns with generic type arguments
        if let Some(type_name) = self.find_props_from_hoc(node, source) {
            return Some(type_name);
        }

        // Look for parameters in the function
        if let Some(params) = self.find_parameters_node(node) {
            // Check first parameter for type annotation
            let mut cursor = params.walk();
            for child in params.children(&mut cursor) {
                if child.kind() == "required_parameter" || child.kind() == "optional_parameter" {
                    // Look for type annotation
                    if let Some(type_annotation) = child.child_by_field_name("type") {
                        let type_text = self.node_text(type_annotation, source);
                        // Clean up the type text
                        let cleaned = type_text.trim().trim_start_matches(':').trim();

                        // If it's a simple type reference, return it
                        if !cleaned.contains('{') && !cleaned.contains('|') {
                            return Some(cleaned.to_string());
                        }
                    }
                }
            }
        }

        None
    }

    /// Find props type from HOC patterns like forwardRef<Ref, Props> or memo<Props>
    fn find_props_from_hoc(&self, node: tree_sitter::Node, source: &[u8]) -> Option<String> {
        // For lexical/variable declarations, look inside for call_expression
        let call_expr = self.find_call_expression(node)?;

        // Check if it's forwardRef or memo
        let callee = call_expr.child_by_field_name("function")?;
        let callee_text = self.node_text(callee, source);

        // Handle forwardRef<Ref, Props> - props is second type arg
        // Handle memo<Props> - props is first type arg
        let type_args = call_expr.child_by_field_name("type_arguments")?;

        let mut cursor = type_args.walk();
        let type_params: Vec<_> = type_args
            .children(&mut cursor)
            .filter(|c| c.kind() != "<" && c.kind() != ">" && c.kind() != ",")
            .collect();

        if callee_text.contains("forwardRef") {
            // forwardRef<RefType, PropsType> - second param is props
            if type_params.len() >= 2 {
                let props_type = self.node_text(type_params[1], source);
                let cleaned = props_type.trim();
                if !cleaned.contains('{') {
                    return Some(cleaned.to_string());
                }
            }
        } else if callee_text.contains("memo") {
            // memo<PropsType> - first param is props
            if !type_params.is_empty() {
                let props_type = self.node_text(type_params[0], source);
                let cleaned = props_type.trim();
                if !cleaned.contains('{') {
                    return Some(cleaned.to_string());
                }
            }
        }

        None
    }

    /// Find call_expression within a node (for HOC patterns)
    fn find_call_expression<'a>(
        &self,
        node: tree_sitter::Node<'a>,
    ) -> Option<tree_sitter::Node<'a>> {
        match node.kind() {
            "call_expression" => Some(node),
            "lexical_declaration" | "variable_declaration" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "variable_declarator" {
                        if let Some(value) = child.child_by_field_name("value") {
                            return self.find_call_expression(value);
                        }
                    }
                }
                None
            }
            _ => None,
        }
    }

    /// Find parameters node (works for function declarations and arrow functions)
    fn find_parameters_node<'a>(
        &self,
        node: tree_sitter::Node<'a>,
    ) -> Option<tree_sitter::Node<'a>> {
        match node.kind() {
            "function_declaration" | "function" | "method_definition" => {
                node.child_by_field_name("parameters")
            }
            "arrow_function" => node.child_by_field_name("parameters"),
            "lexical_declaration" | "variable_declaration" => {
                // Find the arrow function inside
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "variable_declarator" {
                        if let Some(value) = child.child_by_field_name("value") {
                            return self.find_parameters_node(value);
                        }
                    }
                }
                None
            }
            "call_expression" => {
                // For memo(() => {}), forwardRef(() => {})
                if let Some(args) = node.child_by_field_name("arguments") {
                    let mut cursor = args.walk();
                    for arg in args.children(&mut cursor) {
                        if arg.kind() == "arrow_function" || arg.kind() == "function" {
                            return self.find_parameters_node(arg);
                        }
                    }
                }
                None
            }
            _ => None,
        }
    }

    /// Find type/interface definition by name
    fn find_type_definition<'a>(
        &self,
        root: tree_sitter::Node<'a>,
        source: &[u8],
        type_name: &str,
    ) -> Option<tree_sitter::Node<'a>> {
        let mut cursor = root.walk();
        self.find_type_definition_recursive(&mut cursor, source, type_name)
    }

    fn find_type_definition_recursive<'a>(
        &self,
        cursor: &mut tree_sitter::TreeCursor<'a>,
        source: &[u8],
        type_name: &str,
    ) -> Option<tree_sitter::Node<'a>> {
        loop {
            let node = cursor.node();

            match node.kind() {
                "interface_declaration" => {
                    if let Some(name_node) = node.child_by_field_name("name") {
                        if self.node_text(name_node, source) == type_name {
                            return Some(node);
                        }
                    }
                }
                "type_alias_declaration" => {
                    if let Some(name_node) = node.child_by_field_name("name") {
                        if self.node_text(name_node, source) == type_name {
                            return Some(node);
                        }
                    }
                }
                "export_statement" => {
                    // Check inside export
                    if cursor.goto_first_child() {
                        let result = self.find_type_definition_recursive(cursor, source, type_name);
                        cursor.goto_parent();
                        if result.is_some() {
                            return result;
                        }
                    }
                }
                _ => {}
            }

            // Check children
            if cursor.goto_first_child() {
                if let Some(found) = self.find_type_definition_recursive(cursor, source, type_name)
                {
                    return Some(found);
                }
                cursor.goto_parent();
            }

            if !cursor.goto_next_sibling() {
                break;
            }
        }

        None
    }

    /// Extract props from an interface or type definition
    fn extract_props_from_type(
        &self,
        type_node: tree_sitter::Node,
        source: &[u8],
    ) -> Vec<PropInfo> {
        let mut props = Vec::new();

        // Find the object type body
        let body = match type_node.kind() {
            "interface_declaration" => type_node.child_by_field_name("body"),
            "type_alias_declaration" => {
                // Look for object_type in the value
                type_node.child_by_field_name("value")
            }
            _ => None,
        };

        let body = match body {
            Some(b) => b,
            None => return props,
        };

        self.extract_props_from_object_type(body, source, &mut props);

        props
    }

    /// Extract props from an object type node
    fn extract_props_from_object_type(
        &self,
        node: tree_sitter::Node,
        source: &[u8],
        props: &mut Vec<PropInfo>,
    ) {
        let mut cursor = node.walk();
        let mut prev_comment: Option<String> = None;

        for child in node.children(&mut cursor) {
            match child.kind() {
                "comment" => {
                    let text = self.node_text(child, source);
                    if text.starts_with("/**") || text.starts_with("//") {
                        prev_comment = Some(self.parse_jsdoc_description(&text));
                    }
                }
                "property_signature" => {
                    if let Some(prop) =
                        self.extract_property_signature(child, source, &prev_comment)
                    {
                        props.push(prop);
                    }
                    prev_comment = None;
                }
                _ => {
                    prev_comment = None;
                }
            }
        }
    }

    /// Extract a single property signature
    fn extract_property_signature(
        &self,
        node: tree_sitter::Node,
        source: &[u8],
        comment: &Option<String>,
    ) -> Option<PropInfo> {
        let name_node = node.child_by_field_name("name")?;
        let name = self.node_text(name_node, source);

        // Check if optional (has ? modifier)
        let is_optional = node.children(&mut node.walk()).any(|c| c.kind() == "?");

        // Get type annotation
        let (type_annotation, prop_type) = if let Some(type_node) = node.child_by_field_name("type")
        {
            let annotation = self.node_text(type_node, source);
            let parsed = self.parse_type_annotation(&annotation);
            (annotation, parsed)
        } else {
            ("unknown".to_string(), PropType::Unknown)
        };

        Some(PropInfo {
            name,
            prop_type,
            type_annotation,
            required: !is_optional,
            default_value: None, // Would need to check component body for defaults
            description: comment.clone(),
        })
    }

    /// Parse a type annotation string into PropType
    fn parse_type_annotation(&self, annotation: &str) -> PropType {
        let trimmed = annotation.trim();

        // Handle common types
        match trimmed {
            "string" => PropType::String,
            "number" => PropType::Number,
            "boolean" => PropType::Boolean,
            "React.ReactNode" | "ReactNode" | "JSX.Element" => PropType::ReactNode,
            _ => {
                // Check for array types
                if let Some(inner) = trimmed.strip_suffix("[]") {
                    return PropType::Array(Box::new(self.parse_type_annotation(inner)));
                }

                // Check for string literals (union of strings)
                if trimmed.contains('|') && trimmed.contains('"') {
                    let literals: Vec<String> = trimmed
                        .split('|')
                        .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    if !literals.is_empty() {
                        return PropType::StringLiteral(literals);
                    }
                }

                // Check for function types
                if trimmed.contains("=>") {
                    return PropType::Function {
                        params: "...".to_string(),
                        return_type: "void".to_string(),
                    };
                }

                // Fallback to type reference
                PropType::TypeRef(trimmed.to_string())
            }
        }
    }

    /// Extract inline props (when props are defined inline in function parameters)
    fn extract_inline_props(&self, node: tree_sitter::Node, source: &[u8]) -> Vec<PropInfo> {
        let mut props = Vec::new();

        // Find parameters
        let params = match self.find_parameters_node(node) {
            Some(p) => p,
            None => return props,
        };

        // Look for destructured object pattern with type annotation
        let mut cursor = params.walk();
        for child in params.children(&mut cursor) {
            if child.kind() == "required_parameter" || child.kind() == "optional_parameter" {
                // Check if parameter is an object pattern
                if let Some(pattern) = child.child_by_field_name("pattern") {
                    if pattern.kind() == "object_pattern" {
                        // Look for type annotation on the whole object
                        if let Some(type_node) = child.child_by_field_name("type") {
                            // If it's an inline object type
                            if type_node.kind() == "object_type" {
                                self.extract_props_from_object_type(type_node, source, &mut props);
                            }
                        }
                    }
                }
            }
        }

        props
    }

    /// Get text content of a node
    fn node_text(&self, node: tree_sitter::Node, source: &[u8]) -> String {
        let start = node.start_byte();
        let end = node.end_byte();
        String::from_utf8_lossy(&source[start..end]).to_string()
    }
}

impl Default for PropsExtractor {
    fn default() -> Self {
        Self::new().expect("Failed to create props extractor")
    }
}

#[cfg(test)]
#[path = "tests/props_extractor_tests.rs"]
mod tests;
