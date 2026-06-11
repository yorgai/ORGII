//! skills.sh API endpoints + shared HTTP client builder.

use reqwest::Client;

pub(super) const SKILLS_SH_BASE_URL: &str = "https://skills.sh";
pub(super) const SKILLS_SH_SEARCH_PATH: &str = "/api/search";
pub(super) const SKILLS_SH_DOWNLOAD_PATH: &str = "/api/download";

const HTTP_USER_AGENT: &str = "orgii-skills-hub/1.0";

/// Build a reqwest client with our User-Agent.
pub(super) fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(HTTP_USER_AGENT)
        .build()
        .map_err(|err| format!("Failed to build HTTP client: {err}"))
}
