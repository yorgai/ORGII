//! TypeScript language configuration

use super::{MemoizedQuery, TSLanguageConfig};

pub static TYPESCRIPT: TSLanguageConfig = TSLanguageConfig {
    language_ids: &["TypeScript", "TSX"],
    file_extensions: &["ts", "tsx", "mts", "cts"],
    grammar: || tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
    scope_query: MemoizedQuery::new(TYPESCRIPT_SCOPES),
    hoverable_query: MemoizedQuery::new(
        r#"
        [(identifier)
         (property_identifier)
         (shorthand_property_identifier)
         (type_identifier)] @hoverable
        "#,
    ),
    namespaces: &[
        &[
            // values
            "const",
            "let",
            "var",
            "function",
            "parameter",
        ],
        &[
            // types
            "class",
            "interface",
            "type_alias",
            "enum",
        ],
    ],
};

const TYPESCRIPT_SCOPES: &str = r#"
;; Scopes
;; Note: tree-sitter-typescript uses different node types than JavaScript
;; Removed: class_expression, function_expression (not in TS grammar)

[
 (function_declaration)
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
 (statement_block)
 (interface_declaration)
 (type_alias_declaration)
 (enum_declaration)
] @local.scope

;; Definitions

(function_declaration name: (identifier) @hoist.definition.function)
(class_declaration name: (type_identifier) @hoist.definition.class)
(interface_declaration name: (type_identifier) @hoist.definition.interface)
(type_alias_declaration name: (type_identifier) @hoist.definition.type_alias)
(enum_declaration name: (identifier) @hoist.definition.enum)

(variable_declarator name: (identifier) @local.definition.var)
(required_parameter pattern: (identifier) @local.definition.parameter)
(optional_parameter pattern: (identifier) @local.definition.parameter)

(for_in_statement left: (identifier) @local.definition.var)

(import_specifier name: (identifier) @local.import)
(import_clause (identifier) @local.import)
(namespace_import (identifier) @local.import)

;; References

(identifier) @local.reference
(property_identifier) @local.reference
(shorthand_property_identifier) @local.reference
(type_identifier) @local.reference
"#;
