//! JavaScript language configuration

use super::{MemoizedQuery, TSLanguageConfig};

pub static JAVASCRIPT: TSLanguageConfig = TSLanguageConfig {
    language_ids: &["JavaScript", "JSX"],
    file_extensions: &["js", "jsx", "mjs", "cjs"],
    grammar: || tree_sitter_javascript::LANGUAGE.into(),
    scope_query: MemoizedQuery::new(JAVASCRIPT_SCOPES),
    hoverable_query: MemoizedQuery::new(
        r#"
        [(identifier)
         (property_identifier)
         (shorthand_property_identifier)] @hoverable
        "#,
    ),
    namespaces: &[&[
        // values
        "const",
        "let",
        "var",
        "function",
        "parameter",
        // types
        "class",
        // misc
        "label",
    ]],
};

const JAVASCRIPT_SCOPES: &str = r#"
;; Scopes
;; Note: tree-sitter-javascript 0.23 removed class_expression; uses class_declaration in all positions

[
 (function_declaration)
 (function_expression)
 (arrow_function)
 (class_declaration)
 (class_body)
 (method_definition)
 (for_statement)
 (for_in_statement)
 (while_statement)
 (do_statement)
 (if_statement)
 (switch_statement)
 (switch_case)
 (try_statement)
 (catch_clause)
 (block)
] @local.scope

;; Definitions

(function_declaration name: (identifier) @hoist.definition.function)
(class_declaration name: (identifier) @hoist.definition.class)

(variable_declarator name: (identifier) @local.definition.var)
(formal_parameters (identifier) @local.definition.parameter)
(arrow_function parameters: (identifier) @local.definition.parameter)

(for_in_statement left: (identifier) @local.definition.var)

(import_specifier (identifier) @local.import)
(import_clause (identifier) @local.import)
(namespace_import (identifier) @local.import)

;; References

(identifier) @local.reference
(property_identifier) @local.reference
(shorthand_property_identifier) @local.reference
"#;
