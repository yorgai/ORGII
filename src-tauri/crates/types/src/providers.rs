//! Cross-cutting provider constants. These live here (not in
//! `agent_core::core::providers`) so that low-level crates such as
//! `key_vault` can read them without depending on `agent_core`.

/// Environment variable name under which Codex OAuth stores the refresh token.
pub const CODEX_REFRESH_TOKEN_ENV_KEY: &str = "OPENAI_REFRESH_TOKEN";

/// Environment variable name under which the Codex native provider stores
/// the OAuth `id_token`. Read by `key_vault::auto_detect::codex` during
/// credential discovery and consumed by `agent_core::core::providers::
/// codex_native` when constructing the auth file.
pub const CODEX_ID_TOKEN_ENV_KEY: &str = "OPENAI_ID_TOKEN";

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CodexCliAuthConfig {
    #[serde(rename = "OPENAI_API_KEY", default)]
    pub openai_api_key: Option<String>,
    #[serde(default)]
    pub tokens: Option<CodexCliAuthTokens>,
    #[serde(default)]
    pub last_refresh: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CodexCliAuthTokens {
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
}

/// URL fragment that identifies a Kimi-Code provider endpoint.
/// Used by both the provider factory and `key_vault::key_store::
/// agent_env_builder` to recognise Kimi traffic without taking a
/// dependency on the full provider registry.
pub const KIMI_CODE_URL_FRAGMENT: &str = "kimi.com/coding";

pub const CURSOR_NATIVE_HARNESS_TYPE: &str = "cursor_native";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeHarnessType {
    CursorNative,
}

impl NativeHarnessType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CursorNative => CURSOR_NATIVE_HARNESS_TYPE,
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            CURSOR_NATIVE_HARNESS_TYPE => Some(Self::CursorNative),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{NativeHarnessType, CURSOR_NATIVE_HARNESS_TYPE};

    #[test]
    fn native_harness_type_wire_value_is_stable() {
        assert_eq!(CURSOR_NATIVE_HARNESS_TYPE, "cursor_native");
        assert_eq!(NativeHarnessType::CursorNative.as_str(), "cursor_native");
        assert_eq!(
            NativeHarnessType::parse("cursor_native"),
            Some(NativeHarnessType::CursorNative)
        );
        assert_eq!(NativeHarnessType::parse("unknown_native"), None);
    }
}
