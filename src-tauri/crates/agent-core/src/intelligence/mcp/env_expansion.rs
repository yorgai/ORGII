//! Environment variable expansion for MCP server configuration.
//!
//! Lets users write portable `mcp-servers.json` files that read secrets
//! from the host environment:
//!
//! ```json
//! {
//!   "env": { "API_KEY": "${GITHUB_TOKEN}" },
//!   "url": "https://${MCP_HOST:-api.example.com}/mcp",
//!   "headers": { "Authorization": "Bearer ${MCP_TOKEN}" }
//! }
//! ```
//!
//! # Syntax
//!
//! * `${VAR}` — expands to `VAR`'s value; error if unset.
//! * `${VAR:-default}` — expands to `VAR`'s value, or the literal `default`
//!   string if `VAR` is unset or empty. Matches POSIX parameter expansion.
//!
//! Unknown / unmatched patterns pass through literally (so a tool
//! description containing `$NOT_A_VAR` isn't accidentally rewritten).

use std::collections::HashMap;

use super::config::McpServerConfig;

/// Error returned when a required variable (`${VAR}` without default) is
/// unset. We don't silently fall back to `""` — that just breaks connection
/// with a confusing downstream error. Surface it during config load instead.
#[derive(Debug, thiserror::Error)]
#[error(
    "MCP config references undefined env var '{name}' (use ${{{name}:-default}} to allow fallback)"
)]
pub struct MissingEnvVar {
    pub name: String,
}

/// Expand `${VAR}` and `${VAR:-default}` placeholders in a single string.
///
/// Returns `Err(MissingEnvVar)` for bare `${VAR}` when the variable isn't
/// set; the caller should bubble this up as a connection error so the UI
/// can surface it.
pub fn expand(input: &str) -> Result<String, MissingEnvVar> {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // Look for `${`
        if i + 1 < bytes.len() && bytes[i] == b'$' && bytes[i + 1] == b'{' {
            if let Some(end) = find_closing_brace(input, i + 2) {
                let inner = &input[i + 2..end];
                // Split on `:-` to support `${VAR:-default}`
                let (name, default) = match inner.find(":-") {
                    Some(split) => (&inner[..split], Some(&inner[split + 2..])),
                    None => (inner, None),
                };

                let replacement = match std::env::var(name) {
                    Ok(val) if !val.is_empty() => val,
                    Ok(_empty) => match default {
                        Some(def) => def.to_string(),
                        None => {
                            return Err(MissingEnvVar {
                                name: name.to_string(),
                            });
                        }
                    },
                    Err(_) => match default {
                        Some(def) => def.to_string(),
                        None => {
                            return Err(MissingEnvVar {
                                name: name.to_string(),
                            });
                        }
                    },
                };

                out.push_str(&replacement);
                i = end + 1;
                continue;
            }
        }

        out.push(bytes[i] as char);
        i += 1;
    }

    Ok(out)
}

fn find_closing_brace(input: &str, start: usize) -> Option<usize> {
    // No nesting — first unescaped `}` wins. MCP configs don't need
    // arbitrary-depth parameter substitution.
    input[start..].find('}').map(|rel| start + rel)
}

/// Expand every env-var placeholder inside `config` in place.
///
/// Covers `command`, `args`, `env` values, `url`, and `headers` values.
/// `cwd` is left alone — it's a filesystem path and we don't want to
/// encourage putting secrets in directory names.
pub fn expand_server_config(config: &mut McpServerConfig) -> Result<(), MissingEnvVar> {
    if let Some(cmd) = config.command.as_mut() {
        *cmd = expand(cmd)?;
    }

    if let Some(args) = config.args.as_mut() {
        for arg in args.iter_mut() {
            *arg = expand(arg)?;
        }
    }

    if let Some(env) = config.env.as_mut() {
        let expanded: Result<HashMap<String, String>, MissingEnvVar> = env
            .iter()
            .map(|(k, v)| expand(v).map(|ev| (k.clone(), ev)))
            .collect();
        *env = expanded?;
    }

    if let Some(url) = config.url.as_mut() {
        *url = expand(url)?;
    }

    if let Some(headers) = config.headers.as_mut() {
        let expanded: Result<HashMap<String, String>, MissingEnvVar> = headers
            .iter()
            .map(|(k, v)| expand(v).map(|ev| (k.clone(), ev)))
            .collect();
        *headers = expanded?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_env<T>(key: &str, val: &str, f: impl FnOnce() -> T) -> T {
        // SAFETY: tests are single-threaded per `cargo test -- --test-threads=1`
        // is not guaranteed here; env-var tests are inherently racy. We accept
        // that — the logic under test doesn't depend on timing.
        std::env::set_var(key, val);
        let result = f();
        std::env::remove_var(key);
        result
    }

    #[test]
    fn plain_text_passes_through() {
        assert_eq!(expand("hello world").unwrap(), "hello world");
    }

    #[test]
    fn dollar_sign_without_brace_is_literal() {
        assert_eq!(expand("$HOME is literal").unwrap(), "$HOME is literal");
    }

    #[test]
    fn expands_defined_var() {
        with_env("MCP_TEST_EXPAND_A", "hello", || {
            assert_eq!(expand("${MCP_TEST_EXPAND_A}!").unwrap(), "hello!");
        });
    }

    #[test]
    fn undefined_var_errors() {
        std::env::remove_var("MCP_TEST_EXPAND_MISSING");
        let err = expand("${MCP_TEST_EXPAND_MISSING}").unwrap_err();
        assert_eq!(err.name, "MCP_TEST_EXPAND_MISSING");
    }

    #[test]
    fn default_fallback() {
        std::env::remove_var("MCP_TEST_EXPAND_UNSET");
        assert_eq!(
            expand("${MCP_TEST_EXPAND_UNSET:-fallback}").unwrap(),
            "fallback"
        );
    }

    #[test]
    fn empty_var_uses_default() {
        with_env("MCP_TEST_EXPAND_EMPTY", "", || {
            assert_eq!(
                expand("${MCP_TEST_EXPAND_EMPTY:-fallback}").unwrap(),
                "fallback"
            );
        });
    }

    #[test]
    fn mixed_literal_and_expansion() {
        with_env("MCP_TEST_EXPAND_HOST", "api.example.com", || {
            assert_eq!(
                expand("https://${MCP_TEST_EXPAND_HOST}/v1").unwrap(),
                "https://api.example.com/v1"
            );
        });
    }
}
