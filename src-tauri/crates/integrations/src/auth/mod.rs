//! Secure Auth Module
//!
//! Provides token storage using a local JSON file (`~/.orgii/auth_tokens.json`)
//! with restrictive permissions (0o600 on Unix).
//!
//! Also handles OAuth token exchange with Auth0, bypassing browser CORS restrictions.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;

use app_utils::json as json_helpers;

// ============================================
// Constants
// ============================================

const ACCESS_TOKEN_KEY: &str = "hosted_access_token";
const REFRESH_TOKEN_KEY: &str = "hosted_refresh_token";
const TOKEN_EXPIRY_KEY: &str = "hosted_token_expiry";
const USER_ID_KEY: &str = "hosted_user_id";

// ============================================
// Types
// ============================================

/// Token response from Auth0
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
    pub token_type: String,
    pub expires_in: u64,
    #[serde(default)]
    pub scope: Option<String>,
}

/// Error response from Auth0
#[derive(Debug, Serialize, Deserialize)]
pub struct TokenError {
    pub error: String,
    #[serde(default)]
    pub error_description: Option<String>,
}

/// Stored authentication state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthState {
    pub is_authenticated: bool,
    pub access_token: Option<String>,
    pub expires_in: Option<i64>,
    pub user_id: Option<String>,
}

// ============================================
// File-based Storage Functions
// ============================================

fn storage_path() -> std::path::PathBuf {
    app_paths::auth_tokens()
}

fn load_store() -> HashMap<String, String> {
    json_helpers::load_json_store(&storage_path())
}

fn save_store(store: &HashMap<String, String>) -> Result<(), String> {
    json_helpers::save_json_store(&storage_path(), store, "auth tokens")
}

fn store_secret(key: &str, value: &str) -> Result<(), String> {
    let mut store = load_store();
    store.insert(key.to_string(), value.to_string());
    save_store(&store)
}

fn get_secret(key: &str) -> Result<Option<String>, String> {
    let store = load_store();
    Ok(store.get(key).cloned())
}

fn delete_secret(key: &str) -> Result<(), String> {
    let mut store = load_store();
    store.remove(key);
    save_store(&store)
}

// ============================================
// Tauri Commands - Token Storage
// ============================================

/// Store tokens securely in local file
#[command]
pub async fn secure_store_tokens(
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    user_id: Option<String>,
) -> Result<(), String> {
    log::info!("[SecureAuth] Storing tokens");

    store_secret(ACCESS_TOKEN_KEY, &access_token)?;

    if let Some(ref rt) = refresh_token {
        store_secret(REFRESH_TOKEN_KEY, rt)?;
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("Time error: {}", err))?
        .as_secs();
    let expiry = now + expires_in;
    store_secret(TOKEN_EXPIRY_KEY, &expiry.to_string())?;

    if let Some(ref uid) = user_id {
        store_secret(USER_ID_KEY, uid)?;
    }

    log::info!("[SecureAuth] Tokens stored successfully");
    Ok(())
}

/// Get current authentication state
#[command]
pub async fn secure_get_auth_state() -> Result<AuthState, String> {
    log::debug!("[SecureAuth] Getting auth state");

    let access_token = get_secret(ACCESS_TOKEN_KEY)?;
    let expiry_str = get_secret(TOKEN_EXPIRY_KEY)?;
    let user_id = get_secret(USER_ID_KEY)?;

    let is_authenticated = access_token.is_some();

    let expires_in = if let Some(ref expiry) = expiry_str {
        let expiry_ts: u64 = expiry.parse().unwrap_or(0);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|err| format!("Time error: {}", err))?
            .as_secs();
        Some((expiry_ts as i64) - (now as i64))
    } else {
        None
    };

    Ok(AuthState {
        is_authenticated,
        access_token,
        expires_in,
        user_id,
    })
}

/// Get access token (returns None if expired)
#[command]
pub async fn secure_get_access_token() -> Result<Option<String>, String> {
    let access_token = get_secret(ACCESS_TOKEN_KEY)?;
    let expiry_str = get_secret(TOKEN_EXPIRY_KEY)?;

    if let (Some(token), Some(expiry)) = (access_token, expiry_str) {
        let expiry_ts: u64 = expiry.parse().unwrap_or(0);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|err| format!("Time error: {}", err))?
            .as_secs();

        if now < expiry_ts {
            return Ok(Some(token));
        } else {
            log::info!("[SecureAuth] Token expired");
            return Ok(None);
        }
    }

    Ok(None)
}

/// Get refresh token
#[command]
pub async fn secure_get_refresh_token() -> Result<Option<String>, String> {
    get_secret(REFRESH_TOKEN_KEY)
}

/// Check if token is about to expire
#[command]
pub async fn secure_is_token_expiring(threshold_seconds: u64) -> Result<bool, String> {
    let expiry_str = get_secret(TOKEN_EXPIRY_KEY)?;

    if let Some(expiry) = expiry_str {
        let expiry_ts: u64 = expiry.parse().unwrap_or(0);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|err| format!("Time error: {}", err))?
            .as_secs();

        return Ok(now + threshold_seconds >= expiry_ts);
    }

    Ok(true)
}

/// Clear all stored tokens (logout)
#[command]
pub async fn secure_clear_tokens() -> Result<(), String> {
    log::info!("[SecureAuth] Clearing tokens");

    delete_secret(ACCESS_TOKEN_KEY)?;
    delete_secret(REFRESH_TOKEN_KEY)?;
    delete_secret(TOKEN_EXPIRY_KEY)?;
    delete_secret(USER_ID_KEY)?;

    log::info!("[SecureAuth] Tokens cleared");
    Ok(())
}

// ============================================
// Tauri Commands - Auth0 Token Exchange
// ============================================

/// Exchange authorization code for tokens using PKCE
#[command]
pub async fn auth0_exchange_code(
    domain: String,
    client_id: String,
    code: String,
    code_verifier: String,
    redirect_uri: String,
    audience: String,
) -> Result<TokenResponse, String> {
    log::info!("[SecureAuth] Exchanging authorization code for tokens");

    let token_endpoint = format!("https://{}/oauth/token", domain);

    let params = [
        ("grant_type", "authorization_code"),
        ("client_id", &client_id),
        ("code", &code),
        ("code_verifier", &code_verifier),
        ("redirect_uri", &redirect_uri),
        ("audience", &audience),
    ];

    let client = reqwest::Client::new();
    let response = client
        .post(&token_endpoint)
        .form(&params)
        .send()
        .await
        .map_err(|err| format!("HTTP request failed: {}", err))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response body: {}", err))?;

    if status.is_success() {
        let token_response: TokenResponse = serde_json::from_str(&body)
            .map_err(|err| format!("Failed to parse token response: {} - body: {}", err, body))?;

        log::info!("[SecureAuth] Token exchange successful");
        Ok(token_response)
    } else if let Ok(error) = serde_json::from_str::<TokenError>(&body) {
        Err(error.error_description.unwrap_or(error.error))
    } else {
        Err(format!(
            "Token exchange failed with status {}: {}",
            status, body
        ))
    }
}

/// Exchange code and automatically store tokens
#[command]
pub async fn auth0_exchange_and_store(
    domain: String,
    client_id: String,
    code: String,
    code_verifier: String,
    redirect_uri: String,
    audience: String,
    user_id: Option<String>,
) -> Result<TokenResponse, String> {
    let token_response = auth0_exchange_code(
        domain,
        client_id,
        code,
        code_verifier,
        redirect_uri,
        audience,
    )
    .await?;

    secure_store_tokens(
        token_response.access_token.clone(),
        token_response.refresh_token.clone(),
        token_response.expires_in,
        user_id,
    )
    .await?;

    Ok(token_response)
}

/// Refresh access token using refresh token
#[command]
pub async fn auth0_refresh_token(
    domain: String,
    client_id: String,
    refresh_token: String,
) -> Result<TokenResponse, String> {
    log::info!("[SecureAuth] Refreshing access token");

    let token_endpoint = format!("https://{}/oauth/token", domain);

    let params = [
        ("grant_type", "refresh_token"),
        ("client_id", &client_id),
        ("refresh_token", &refresh_token),
    ];

    let client = reqwest::Client::new();
    let response = client
        .post(&token_endpoint)
        .form(&params)
        .send()
        .await
        .map_err(|err| format!("HTTP request failed: {}", err))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|err| format!("Failed to read response body: {}", err))?;

    if status.is_success() {
        let token_response: TokenResponse = serde_json::from_str(&body)
            .map_err(|err| format!("Failed to parse token response: {} - body: {}", err, body))?;

        log::info!("[SecureAuth] Token refresh successful");
        Ok(token_response)
    } else if let Ok(error) = serde_json::from_str::<TokenError>(&body) {
        Err(error.error_description.unwrap_or(error.error))
    } else {
        Err(format!(
            "Token refresh failed with status {}: {}",
            status, body
        ))
    }
}

/// Refresh token and automatically update storage
#[command]
pub async fn auth0_refresh_and_store(
    domain: String,
    client_id: String,
) -> Result<TokenResponse, String> {
    let refresh_token =
        get_secret(REFRESH_TOKEN_KEY)?.ok_or_else(|| "No refresh token stored".to_string())?;

    let token_response = auth0_refresh_token(domain, client_id, refresh_token).await?;

    secure_store_tokens(
        token_response.access_token.clone(),
        token_response.refresh_token.clone(),
        token_response.expires_in,
        None,
    )
    .await?;

    Ok(token_response)
}

/// Revoke refresh token on logout
#[command]
pub async fn auth0_revoke_token(domain: String, client_id: String) -> Result<(), String> {
    let refresh_token = match get_secret(REFRESH_TOKEN_KEY)? {
        Some(rt) => rt,
        None => return Ok(()),
    };

    log::info!("[SecureAuth] Revoking refresh token");

    let revoke_endpoint = format!("https://{}/oauth/revoke", domain);

    let params = [("client_id", &client_id), ("token", &refresh_token)];

    let client = reqwest::Client::new();
    let _ = client.post(&revoke_endpoint).form(&params).send().await;

    secure_clear_tokens().await?;

    log::info!("[SecureAuth] Token revoked and cleared");
    Ok(())
}
