//! Python language configuration

use super::{MemoizedQuery, TSLanguageConfig};

pub static PYTHON: TSLanguageConfig = TSLanguageConfig {
    language_ids: &["Python"],
    file_extensions: &["py", "pyi", "pyw"],
    grammar: || tree_sitter_python::LANGUAGE.into(),
    scope_query: MemoizedQuery::new(PYTHON_SCOPES),
    hoverable_query: MemoizedQuery::new(
        r#"
        (identifier) @hoverable
        "#,
    ),
    namespaces: &[&[
        // values
        "variable",
        "function",
        "parameter",
        // types
        "class",
        // misc
        "module",
    ]],
};

const PYTHON_SCOPES: &str = r#"
;; Scopes

[
 (function_definition)
 (class_definition)
 (for_statement)
 (while_statement)
 (if_statement)
 (with_statement)
 (try_statement)
 (except_clause)
 (lambda)
 (list_comprehension)
 (dictionary_comprehension)
 (set_comprehension)
 (generator_expression)
] @local.scope

;; Definitions

(function_definition name: (identifier) @local.definition.function)
(class_definition name: (identifier) @local.definition.class)

(assignment left: (identifier) @local.definition.variable)
(augmented_assignment left: (identifier) @local.definition.variable)

(parameters (identifier) @local.definition.parameter)
(parameters (default_parameter name: (identifier) @local.definition.parameter))
(parameters (typed_parameter (identifier) @local.definition.parameter))
(parameters (typed_default_parameter name: (identifier) @local.definition.parameter))
(lambda_parameters (identifier) @local.definition.parameter)

(for_statement left: (identifier) @local.definition.variable)
(for_statement left: (tuple_pattern (identifier) @local.definition.variable))
(with_clause (with_item value: (as_pattern alias: (as_pattern_target (identifier) @local.definition.variable))))
(except_clause (identifier) @local.definition.variable)

;; Imports

(import_statement name: (dotted_name (identifier) @local.import))
(import_from_statement name: (dotted_name (identifier) @local.import))
(aliased_import alias: (identifier) @local.import)

;; References

(identifier) @local.reference
"#;
