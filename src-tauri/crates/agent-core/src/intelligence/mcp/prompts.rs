//! MCP Prompt types.
//!
//! Prompts are server-authored message templates that the user can invoke
//! as slash-commands of the form `/<server>:<prompt> arg1 arg2`. Each
//! prompt is exposed via `prompts/list` (enumerate with arg schemas) and
//! executed via `prompts/get` (render argument-filled messages).
//!
//! We keep the frontend-facing shape flat — no references to `rmcp`
//! types leak out. The conversion lives in `client.rs::list_prompts` /
//! `client.rs::get_prompt`.

use serde::{Deserialize, Serialize};

/// Argument declared by an MCP prompt template.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptArgument {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
}

/// A prompt template advertised by an MCP server.
///
/// Mirrors `rmcp::model::Prompt` but flattens `arguments` to a plain `Vec`
/// (always emitted, empty by default) so downstream serializers never have
/// to deal with `Option<Vec<_>>`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpPrompt {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub arguments: Vec<McpPromptArgument>,
}

/// Role of a single message inside a rendered prompt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpPromptMessageRole {
    User,
    Assistant,
}

/// A single message returned by `prompts/get`.
///
/// Images / resources / resource-links are flattened into plain text so
/// the frontend can inject the prompt as a chat message without having
/// to understand all four MCP content variants. The contract is: every
/// `prompts/get` response leaves this layer as `(role, text)` pairs;
/// non-text content is rendered to a string here, never forwarded as
/// structured payload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptMessage {
    pub role: McpPromptMessageRole,
    pub text: String,
}

/// Result of invoking a prompt via `prompts/get`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpPromptRendered {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub messages: Vec<McpPromptMessage>,
}

impl McpPromptRendered {
    /// Collapse all messages into a single user-facing string that the
    /// chat input can pre-populate. Roles are emitted as simple prefixes
    /// (`User: ...`, `Assistant: ...`) so the agent can tell which side
    /// said what after the user sends it as a message.
    ///
    /// The slash-command output is injected into the chat input as plain
    /// text — never dispatched as a structured multi-role exchange — so
    /// the user can review and edit it before sending.
    pub fn flatten_to_text(&self) -> String {
        let mut out = String::new();
        for (idx, msg) in self.messages.iter().enumerate() {
            if idx > 0 {
                out.push_str("\n\n");
            }
            let prefix = match msg.role {
                McpPromptMessageRole::User => "User:",
                McpPromptMessageRole::Assistant => "Assistant:",
            };
            out.push_str(prefix);
            out.push(' ');
            out.push_str(&msg.text);
        }
        out
    }
}
