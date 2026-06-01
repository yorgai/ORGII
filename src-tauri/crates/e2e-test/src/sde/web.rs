//! E2E scenarios for web tools (`web_fetch`, `web_search`).

use super::tmp_workspace_path;
use crate::config::Config;
use crate::harness;

/// Verify that `web_fetch` converts HTML to Markdown and preserves headings.
pub async fn web_fetch_html_quality(cfg: &Config) -> bool {
    let session_id = format!("{}-web-fetch-html", cfg.session_prefix);
    let project = tmp_workspace_path("web-fetch-html");
    let _ = std::fs::create_dir_all(&project);

    match harness::send_sde_message(
        cfg,
        "Use web_fetch to fetch https://httpbin.org/html and tell me the exact heading text you see in the page.",
        &session_id,
        "build",
        &project,
        None,
        false,
    )
    .await
    {
        Err(err) => harness::print_error("Web Fetch HTML Quality", &err),
        Ok(resp) => {
            let content_lower = resp.content.to_lowercase();
            harness::print_result(
                "Web Fetch HTML Quality",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    (
                        "Used web_fetch tool",
                        harness::assert_sde_tool_used(&resp, "web_fetch"),
                    ),
                    (
                        "Heading text preserved (Herman Melville)",
                        content_lower.contains("herman melville")
                            || content_lower.contains("moby"),
                    ),
                ],
            )
        }
    }
}
