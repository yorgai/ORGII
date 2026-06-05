//! GitHub API Client
//!
//! Thin wrapper around `reqwest` for the GitHub REST and GraphQL APIs.
//! Takes a bearer token directly — credential resolution happens at the
//! command layer (`commands::resolve_token`) via the centralized
//! `project_management::sync::connection_token_store`.
//!
//! 401 responses surface to the caller as `Err("GitHubReAuthRequired: …")`;
//! the user re-authorizes through the Connections wizard.

use reqwest::{Client, Method, Response, StatusCode};
use serde_json::Value;

const GITHUB_API_URL: &str = "https://api.github.com";
const GITHUB_GRAPHQL_URL: &str = "https://api.github.com/graphql";
const USER_AGENT: &str = "ORGII-Desktop/1.0";

pub struct GitHubClient {
    http: Client,
    token: String,
}

impl GitHubClient {
    pub fn new(token: String) -> Self {
        Self {
            http: Client::new(),
            token,
        }
    }

    pub async fn get(&self, path: &str) -> Result<Value, String> {
        self.request(Method::GET, path, None).await
    }

    pub async fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        self.request(Method::POST, path, Some(body)).await
    }

    /// PATCH request to the GitHub REST API with a JSON body.
    pub async fn patch(&self, path: &str, body: Value) -> Result<Value, String> {
        self.request(Method::PATCH, path, Some(body)).await
    }

    pub async fn graphql(&self, query: &str, variables: Value) -> Result<Value, String> {
        log::info!("[GitHub][GraphQL] Executing query");
        let body = serde_json::json!({ "query": query, "variables": variables });
        let resp = self
            .http
            .post(GITHUB_GRAPHQL_URL)
            .bearer_auth(&self.token)
            .header("User-Agent", USER_AGENT)
            .json(&body)
            .send()
            .await
            .map_err(|err| format!("GitHub GraphQL request failed: {err}"))?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            return Err("GitHubReAuthRequired: GraphQL returned 401".to_string());
        }
        Self::parse_response(resp).await
    }

    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        log::info!("[GitHub][API] {} {}", method, path);
        let resp = self
            .do_rest_request(method.clone(), path, body.as_ref())
            .await?;
        if resp.status() == StatusCode::UNAUTHORIZED {
            return Err(format!(
                "GitHubReAuthRequired: {method} {path} returned 401"
            ));
        }
        Self::parse_response(resp).await
    }

    async fn do_rest_request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Response, String> {
        let url = format!("{GITHUB_API_URL}{path}");
        let mut req = self
            .http
            .request(method, &url)
            .bearer_auth(&self.token)
            .header("Accept", "application/vnd.github.v3+json")
            .header("User-Agent", USER_AGENT);
        if let Some(payload) = body {
            req = req.json(payload);
        }
        req.send()
            .await
            .map_err(|err| format!("GitHub API request failed: {err}"))
    }

    async fn parse_response(resp: Response) -> Result<Value, String> {
        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|err| format!("Failed to read response body: {err}"))?;
        if status.is_success() {
            if body.is_empty() {
                return Ok(Value::Null);
            }
            serde_json::from_str(&body).map_err(|err| format!("Failed to parse JSON: {err}"))
        } else {
            Err(format!("GitHub API error {}: {}", status.as_u16(), body))
        }
    }
}
