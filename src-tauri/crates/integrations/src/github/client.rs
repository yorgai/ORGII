//! GitHub API Client
//!
//! Unified entry point for all GitHub API calls. Handles authentication
//! via OAuth token from local storage, with automatic 401 detection and
//! token refresh fallback through the ORGII hosted service.

use reqwest::{Client, Method, Response, StatusCode};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::OnceCell;

use super::token_store;

const GITHUB_API_URL: &str = "https://api.github.com";
const GITHUB_GRAPHQL_URL: &str = "https://api.github.com/graphql";
const USER_AGENT: &str = "ORGII-Desktop/1.0";

/// Result of attempting to refresh a GitHub token via the server.
enum TokenRefreshResult {
    /// Got a new valid token.
    Refreshed(String),
    /// Server cannot refresh either; user must re-authorize.
    ReAuthRequired,
}

/// GitHub API client with built-in 401 retry logic.
///
/// On a 401 response, it calls the hosted service's `/github/oauth/refresh`
/// endpoint. If that succeeds, the new token is saved to keychain and the
/// original request is retried once. If refresh also fails, the stale token
/// is cleared and a `GitHubReAuthRequired` error is returned.
///
/// Uses an in-memory `OnceCell` to deduplicate token bootstrap: when many
/// concurrent requests all find an empty keychain, only one refresh fires
/// and the rest wait for its result.
pub struct GitHubClient {
    http: Client,
    user_id: String,
    hosted_service_url: String,
    hosted_token: String,
    /// In-memory token cache. Populated once by the first caller that
    /// successfully reads from local storage or refreshes from the server.
    /// All subsequent calls reuse this without hitting disk again.
    cached_token: Arc<OnceCell<String>>,
}

impl GitHubClient {
    pub fn new(user_id: String, hosted_service_url: String, hosted_token: String) -> Self {
        Self {
            http: Client::new(),
            user_id,
            hosted_service_url,
            hosted_token,
            cached_token: Arc::new(OnceCell::new()),
        }
    }

    /// GET request to the GitHub REST API.
    pub async fn get(&self, path: &str) -> Result<Value, String> {
        self.request(Method::GET, path, None).await
    }

    /// POST request to the GitHub REST API with a JSON body.
    pub async fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        self.request(Method::POST, path, Some(body)).await
    }

    /// POST a GraphQL query to GitHub's GraphQL endpoint.
    pub async fn graphql(&self, query: &str, variables: Value) -> Result<Value, String> {
        log::info!("[GitHub][GraphQL] Executing query");
        let token = self.get_or_refresh_token().await?;
        let body = serde_json::json!({ "query": query, "variables": variables });

        let resp = self.do_graphql_request(&token, &body).await?;

        if resp.status() == StatusCode::UNAUTHORIZED {
            log::info!("[GitHub][GraphQL] Got 401, attempting token refresh");
            return self.handle_unauthorized_graphql(&body).await;
        }

        Self::parse_response(resp).await
    }

    // ---- Private: core request with 401 retry ----

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        log::info!("[GitHub][API] {} {}", method, path);
        let token = self.get_or_refresh_token().await?;
        let resp = self
            .do_rest_request(&token, method.clone(), path, body.as_ref())
            .await?;

        if resp.status() == StatusCode::UNAUTHORIZED {
            log::info!(
                "[GitHub][API] Got 401 for {} {}, attempting token refresh",
                method,
                path
            );
            return self
                .handle_unauthorized_rest(method, path, body.as_ref())
                .await;
        }

        Self::parse_response(resp).await
    }

    /// Try to obtain a token: check in-memory cache, then local storage, then server refresh.
    /// Uses OnceCell so only one refresh fires even with many concurrent callers.
    async fn get_or_refresh_token(&self) -> Result<String, String> {
        let cell = self.cached_token.clone();
        cell.get_or_try_init(|| async {
            // 1. Check local storage
            if let Some(token) = token_store::get(&self.user_id)? {
                return Ok(token);
            }

            // 2. No stored token — try server refresh (bootstrap for pre-migration users)
            log::info!(
                "[GitHub][API] No token stored for {}, attempting server refresh to bootstrap",
                self.user_id
            );
            match self.try_refresh_token().await? {
                TokenRefreshResult::Refreshed(new_token) => {
                    log::info!("[GitHub][API] Bootstrapped token from server refresh");
                    token_store::save(&self.user_id, &new_token)?;
                    Ok(new_token)
                }
                TokenRefreshResult::ReAuthRequired => {
                    Err("GitHubReAuthRequired: no token and refresh failed".to_string())
                }
            }
        })
        .await
        .cloned()
    }

    // ---- Private: raw HTTP helpers ----

    async fn do_rest_request(
        &self,
        token: &str,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Response, String> {
        let url = format!("{}{}", GITHUB_API_URL, path);
        let mut req = self
            .http
            .request(method, &url)
            .bearer_auth(token)
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", USER_AGENT);

        if let Some(b) = body {
            req = req.json(b);
        }

        req.send()
            .await
            .map_err(|e| format!("GitHub API request failed: {}", e))
    }

    async fn do_graphql_request(&self, token: &str, body: &Value) -> Result<Response, String> {
        self.http
            .post(GITHUB_GRAPHQL_URL)
            .bearer_auth(token)
            .header("User-Agent", USER_AGENT)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("GitHub GraphQL request failed: {}", e))
    }

    // ---- Private: 401 handling ----

    async fn handle_unauthorized_rest(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, String> {
        match self.try_refresh_token().await? {
            TokenRefreshResult::Refreshed(new_token) => {
                log::info!(
                    "[GitHub][API] Token refreshed, retrying {} {}",
                    method,
                    path
                );
                token_store::save(&self.user_id, &new_token)?;
                let retry = self.do_rest_request(&new_token, method, path, body).await?;
                Self::parse_response(retry).await
            }
            TokenRefreshResult::ReAuthRequired => {
                log::info!("[GitHub][API] Refresh failed, clearing token — re-auth required");
                token_store::clear(&self.user_id)?;
                Err("GitHubReAuthRequired".to_string())
            }
        }
    }

    async fn handle_unauthorized_graphql(&self, body: &Value) -> Result<Value, String> {
        match self.try_refresh_token().await? {
            TokenRefreshResult::Refreshed(new_token) => {
                log::info!("[GitHub][GraphQL] Token refreshed, retrying query");
                token_store::save(&self.user_id, &new_token)?;
                let retry = self.do_graphql_request(&new_token, body).await?;
                Self::parse_response(retry).await
            }
            TokenRefreshResult::ReAuthRequired => {
                log::info!("[GitHub][GraphQL] Refresh failed, clearing token — re-auth required");
                token_store::clear(&self.user_id)?;
                Err("GitHubReAuthRequired".to_string())
            }
        }
    }

    // ---- Private: token refresh via hosted service ----

    async fn try_refresh_token(&self) -> Result<TokenRefreshResult, String> {
        let url = format!(
            "{}/github/oauth/refresh?user_id={}",
            self.hosted_service_url,
            urlencoding::encode(&self.user_id)
        );
        log::info!("[GitHub][Refresh] Requesting token refresh from {}", url);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.hosted_token)
            .send()
            .await
            .map_err(|e| format!("Token refresh request failed: {}", e))?;

        if resp.status().is_success() {
            let data: Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse refresh response: {}", e))?;

            if let Some(token) = data["data"]["access_token"].as_str() {
                log::info!("[GitHub][Refresh] Got new token from server");
                return Ok(TokenRefreshResult::Refreshed(token.to_string()));
            }
        }

        log::info!("[GitHub][Refresh] Server could not refresh token, re-auth required");
        Ok(TokenRefreshResult::ReAuthRequired)
    }

    // ---- Private: response parsing ----

    async fn parse_response(resp: Response) -> Result<Value, String> {
        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {}", e))?;

        if status.is_success() {
            if body.is_empty() {
                return Ok(Value::Null);
            }
            serde_json::from_str(&body).map_err(|e| format!("Failed to parse JSON: {}", e))
        } else {
            Err(format!("GitHub API error {}: {}", status.as_u16(), body))
        }
    }
}
