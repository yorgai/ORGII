//! ClawHub API endpoints + shared HTTP client builder.

use reqwest::Client;

pub(super) const CLAWHUB_BASE_URL: &str = "https://clawhub.ai";
pub(super) const CLAWHUB_SEARCH_PATH: &str = "/api/v1/search";
pub(super) const CLAWHUB_SKILLS_PATH: &str = "/api/v1/skills";

const HTTP_USER_AGENT: &str = "orgii-skills-hub/1.0";

/// Build a reqwest client with our User-Agent.
pub(super) fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(HTTP_USER_AGENT)
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))
}
