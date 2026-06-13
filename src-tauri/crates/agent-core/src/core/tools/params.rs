//! Schema generation, parameter parsing, and tool-name sanitization.
//!
//! Two paths exist:
//! - **Type-safe (recommended)**: `params_schema::<T>()` + `parse_params::<T>(value)`
//!   for tools that derive `JsonSchema` + `Deserialize` on a typed params struct.
//! - **Untyped helpers**: `required_string`, `optional_string`, `optional_int`,
//!   `optional_bool` for legacy tools that still hand-pull individual JSON keys.
//!   New tools should NOT use these — migrate via the typed path.

use schemars::JsonSchema;
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::error::ToolError;

// ============================================
// Tool-name sanitization
// ============================================

/// Sanitize a tool name to match the Anthropic/OpenAI function name regex `^[a-zA-Z0-9_-]+$`.
/// Replaces spaces and other invalid characters with underscores.
pub fn sanitize_tool_name(name: &str) -> String {
    name.chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

/// Guarantee the value is a JSON Schema with `"type": "object"`.
/// If it already has that field, return as-is. Otherwise wrap it.
pub(crate) fn ensure_object_schema(schema: Value) -> Value {
    if let Some(obj) = schema.as_object() {
        if obj.get("type").and_then(|v| v.as_str()) == Some("object") {
            return schema;
        }
        if obj.contains_key("properties") {
            let mut patched = obj.clone();
            patched.insert("type".into(), Value::String("object".into()));
            return Value::Object(patched);
        }
    }
    serde_json::json!({
        "type": "object",
        "properties": {}
    })
}

// ============================================
// Type-Safe Parameter Helpers (Recommended)
// ============================================

/// Generate a JSON Schema from a Rust type.
///
/// Use this in `Tool::parameters()` to get automatic schema generation:
/// ```ignore
/// fn parameters(&self) -> Value {
///     params_schema::<MyParams>()
/// }
/// ```
pub fn params_schema<T: JsonSchema>() -> Value {
    // Use Draft 7 (which OpenAI function-calling expects) with no meta_schema
    // URL.  OpenAPI 3.0 mode adds `$schema`, `nullable`, and `title` fields
    // that some proxies try to resolve, inflating token counts dramatically.
    let schema = schemars::generate::SchemaSettings::draft07()
        .with(|settings| {
            settings.meta_schema = None;
        })
        .into_generator()
        .into_root_schema_for::<T>();
    // schemars produces a `Schema` whose serde representation is a plain
    // JSON Object — `to_value` is structurally infallible. The previous
    // `unwrap_or_else({"type": "object", "properties": {}})` would have
    // silently registered the tool with an empty schema if a custom
    // serializer ever panicked, which means the LLM would believe the
    // tool accepts any arguments — every tool call would then likely fail
    // at the typed `parse_params` step with a confusing
    // `parameter validation failed` error and no schema-level signal of
    // why. Same anti-pattern as the MCP tool input-schema sweep already
    // landed; pin the infallible contract via `expect`.
    serde_json::to_value(schema)
        .expect("schemars Schema serializes to JSON Object; infallible for any JsonSchema type")
}

/// Parse and validate tool parameters from JSON into a typed struct.
///
/// Use this in `Tool::execute()` to get automatic deserialization + validation:
/// ```ignore
/// async fn execute(&self, params: Value) -> Result<String, ToolError> {
///     let params: MyParams = parse_params(params)?;
///     // params is now fully typed!
/// }
/// ```
pub fn parse_params<T: DeserializeOwned>(params: Value) -> Result<T, ToolError> {
    // No `__`-prefix stripping needed: per-call framework metadata is
    // threaded via `CallContext` since the call_context refactor — the
    // params `Value` carries only LLM-supplied arguments. If a `__`-key
    // ever shows up here it's a real wiring bug, not metadata leakage,
    // and `deny_unknown_fields` will surface it.
    serde_json::from_value(params)
        .map_err(|err| ToolError::InvalidParams(format!("parameter validation failed: {}", err)))
}

/// Like [`parse_params`], but on failure appends a summary of the expected
/// schema (property names/types and the required list) so the model can
/// self-correct in one round trip instead of guessing. Use for tools whose
/// schema may not have reached the model intact (provider-side flattening).
pub fn parse_params_described<T: DeserializeOwned + JsonSchema>(
    params: Value,
) -> Result<T, ToolError> {
    serde_json::from_value(params).map_err(|err| {
        ToolError::InvalidParams(format!(
            "parameter validation failed: {}. Expected parameters — {}",
            err,
            schema_summary(&params_schema::<T>())
        ))
    })
}

/// One-line human/model-readable summary of a parameters schema:
/// `field: type (required), other: type`.
fn schema_summary(schema: &Value) -> String {
    let Some(obj) = schema.as_object() else {
        return "(no schema)".to_string();
    };
    let required: Vec<&str> = obj
        .get("required")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let Some(props) = obj.get("properties").and_then(|v| v.as_object()) else {
        return "(no parameters)".to_string();
    };
    if props.is_empty() {
        return "(no parameters)".to_string();
    }
    props
        .iter()
        .map(|(name, prop)| {
            let ty = prop
                .get("type")
                .map(|t| match t {
                    Value::String(s) => s.clone(),
                    Value::Array(parts) => parts
                        .iter()
                        .filter_map(|p| p.as_str())
                        .collect::<Vec<_>>()
                        .join("|"),
                    _ => "any".to_string(),
                })
                .unwrap_or_else(|| "any".to_string());
            if required.contains(&name.as_str()) {
                format!("{}: {} (required)", name, ty)
            } else {
                format!("{}: {}", name, ty)
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}

// ============================================
// LLM schema compatibility contract
// ============================================

/// Validate that a tool parameters schema is expressible in the
/// least-common-denominator function-calling dialect that every LLM
/// provider (and every proxy in between) understands.
///
/// Schemas that violate this contract get silently flattened to
/// `"properties": {}` somewhere between the registry and the model —
/// the model then cannot see any fields and every call fails at
/// `parse_params` with a confusing "missing field" error. The classic
/// trigger is a `#[serde(tag = "action")]` enum, which schemars renders
/// as a top-level `oneOf` with no top-level `properties`.
///
/// Rules:
/// - top level must be `type: "object"` with a `properties` key
/// - no `oneOf` / `anyOf` / `allOf` / `$ref` anywhere in the schema
/// - every name in `required` must exist in `properties`
pub fn assert_llm_compatible_schema(schema: &Value) -> Result<(), String> {
    let obj = schema
        .as_object()
        .ok_or_else(|| "schema must be a JSON object".to_string())?;

    if obj.get("type").and_then(|v| v.as_str()) != Some("object") {
        return Err("top-level `type` must be \"object\"".to_string());
    }
    let props = obj
        .get("properties")
        .ok_or_else(|| "top-level `properties` is missing".to_string())?
        .as_object()
        .ok_or_else(|| "top-level `properties` must be an object".to_string())?;

    if let Some(required) = obj.get("required").and_then(|v| v.as_array()) {
        for name in required.iter().filter_map(|v| v.as_str()) {
            if !props.contains_key(name) {
                return Err(format!(
                    "`required` lists \"{}\" which is not in `properties`",
                    name
                ));
            }
        }
    }

    scan_for_forbidden_keywords(schema, "$")
}

fn scan_for_forbidden_keywords(value: &Value, path: &str) -> Result<(), String> {
    const FORBIDDEN: [&str; 4] = ["oneOf", "anyOf", "allOf", "$ref"];
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if FORBIDDEN.contains(&key.as_str()) {
                    return Err(format!(
                        "`{}` at {} is not portable across LLM providers; flatten the schema \
                         (plain object with scalar properties) instead",
                        key, path
                    ));
                }
                scan_for_forbidden_keywords(child, &format!("{}.{}", path, key))?;
            }
            Ok(())
        }
        Value::Array(items) => {
            for (idx, child) in items.iter().enumerate() {
                scan_for_forbidden_keywords(child, &format!("{}[{}]", path, idx))?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

// ============================================
// Untyped helpers (legacy migration path)
// ============================================
//
// Tools that haven't migrated to `parse_params<T>()` yet pull individual
// keys via these helpers. Two of the original five (`required_int`,
// `validate_required_keys`) had no production callers and were deleted.
// Remaining helpers stay until the last call site is migrated.

/// Extract a required string parameter from a JSON object.
pub fn required_string(params: &Value, key: &str) -> Result<String, ToolError> {
    params
        .get(key)
        .and_then(|val| val.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ToolError::InvalidParams(format!("missing required parameter: {}", key)))
}

/// Extract an optional string parameter from a JSON object.
pub fn optional_string(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(|val| val.as_str())
        .map(|s| s.to_string())
}

/// Extract an optional integer parameter from a JSON object.
pub fn optional_int(params: &Value, key: &str) -> Option<i64> {
    params.get(key).and_then(|val| val.as_i64())
}

/// Extract an optional boolean parameter from a JSON object.
pub fn optional_bool(params: &Value, key: &str) -> Option<bool> {
    params.get(key).and_then(|val| val.as_bool())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    /// Mirrors the agent-org task tools: strict params that reject any
    /// unknown LLM-supplied field.
    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct StrictParams {
        subject: String,
    }

    #[test]
    fn parse_params_accepts_clean_strict_params() {
        let params = serde_json::json!({
            "subject": "audit yoyo-evolve",
        });
        let parsed: StrictParams = parse_params(params).expect("clean params must deserialize");
        assert_eq!(parsed.subject, "audit yoyo-evolve");
    }

    #[test]
    fn parse_params_rejects_unknown_fields_including_framework_meta() {
        // Post-CallContext refactor: framework metadata flows via
        // CallContext, NOT via `__`-prefixed keys in params. If anyone
        // ever puts `__`-keys back into params they must show up as a
        // real validation failure here — that surfaces the wiring bug
        // rather than silently swallowing it.
        let meta_leaked = serde_json::json!({
            "subject": "x",
            "__call_id": "call-1",
        });
        let result: Result<StrictParams, _> = parse_params(meta_leaked);
        assert!(
            result.is_err(),
            "framework meta in params is a wiring bug, must fail closed"
        );

        let real_unknown = serde_json::json!({
            "subject": "x",
            "bogus_field": true,
        });
        let result: Result<StrictParams, _> = parse_params(real_unknown);
        assert!(
            result.is_err(),
            "non-framework unknown fields must still fail closed"
        );
    }
}
