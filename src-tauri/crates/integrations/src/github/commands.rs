//! GitHub Tauri Commands
//!
//! Exposes GitHub operations to the frontend via `invoke()`.
//! Replaces the previous HTTP calls to legacy server (port 8001).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::ffi::OsString;
use std::path::Path;
use tauri::command;

use git::git_command;

use super::client::GitHubClient;
use super::token_store;

// ============================================
// Types
// ============================================

#[derive(Debug, Serialize, Deserialize)]
pub struct Repo {
    pub id: u64,
    pub full_name: String,
    pub name: String,
    pub private: bool,
    pub description: Option<String>,
    pub html_url: String,
    pub default_branch: String,
    pub language: Option<String>,
    pub stargazers_count: u64,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Branch {
    pub name: String,
    pub sha: String,
    pub protected: bool,
}

#[derive(Debug, Deserialize)]
pub struct CreatePRRequest {
    pub repo_full_name: String,
    pub title: String,
    pub head: String,
    pub base: String,
    pub body: Option<String>,
    pub draft: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct PRResponse {
    pub number: u64,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct FindPRResponse {
    pub number: u64,
    pub url: String,
    pub state: String,
}

#[derive(Debug, Serialize)]
pub struct GitHubGitCredential {
    pub username: String,
    pub token: String,
    pub repo_full_name: String,
}

// ============================================
// Helpers
// ============================================

fn make_client(user_id: &str, hosted_service_url: &str, hosted_token: &str) -> GitHubClient {
    GitHubClient::new(
        user_id.to_string(),
        hosted_service_url.to_string(),
        hosted_token.to_string(),
    )
}

fn parse_repo(v: &Value) -> Repo {
    Repo {
        id: v["id"].as_u64().unwrap_or(0),
        full_name: v["full_name"].as_str().unwrap_or("").to_string(),
        name: v["name"].as_str().unwrap_or("").to_string(),
        private: v["private"].as_bool().unwrap_or(false),
        description: v["description"].as_str().map(String::from),
        html_url: v["html_url"].as_str().unwrap_or("").to_string(),
        default_branch: v["default_branch"].as_str().unwrap_or("main").to_string(),
        language: v["language"].as_str().map(String::from),
        stargazers_count: v["stargazers_count"].as_u64().unwrap_or(0),
        updated_at: v["updated_at"].as_str().unwrap_or("").to_string(),
    }
}

fn parse_branch(v: &Value) -> Branch {
    Branch {
        name: v["name"].as_str().unwrap_or("").to_string(),
        sha: v["commit"]["sha"].as_str().unwrap_or("").to_string(),
        protected: v["protected"].as_bool().unwrap_or(false),
    }
}

fn clean_repo_path(path: &str) -> Option<String> {
    let clean_path = path.trim_start_matches('/').trim_end_matches(".git");
    let mut parts = clean_path.split('/');
    let owner = parts.next()?.trim();
    let repo = parts.next()?.trim();
    if owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

pub(crate) fn github_repo_full_name_from_remote(remote_url: &str) -> Option<String> {
    let trimmed = remote_url.trim();
    if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        return clean_repo_path(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("http://github.com/") {
        return clean_repo_path(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        return clean_repo_path(rest);
    }
    if let Some(rest) = trimmed.strip_prefix("ssh://git@github.com/") {
        return clean_repo_path(rest);
    }
    None
}

// ============================================
// Tauri Commands
// ============================================

/// Exchange a one-time ticket for a GitHub token and store it locally.
/// Called by the frontend after OAuth redirect with `?token_ticket=xxx`.
#[command]
pub async fn github_store_token(
    user_id: String,
    ticket: String,
    hosted_service_url: String,
    hosted_token: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "{}/github/oauth/exchange-ticket",
            hosted_service_url
        ))
        .bearer_auth(&hosted_token)
        .json(&json!({ "ticket": ticket }))
        .send()
        .await
        .map_err(|e| format!("Ticket exchange failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ticket exchange error: {}", body));
    }

    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse ticket response: {}", e))?;

    let access_token = data["data"]["access_token"]
        .as_str()
        .ok_or("No access_token in ticket response")?;

    token_store::save(&user_id, access_token)?;
    log::info!("[GitHub] Token stored for user {}", user_id);
    Ok(())
}

/// List the authenticated user's repositories.
#[command]
pub async fn github_list_repos(
    user_id: String,
    page: Option<u32>,
    per_page: Option<u32>,
    hosted_service_url: String,
    hosted_token: String,
) -> Result<Vec<Repo>, String> {
    log::info!("[GitHub][Cmd] list_repos user={} page={:?}", user_id, page);
    let client = make_client(&user_id, &hosted_service_url, &hosted_token);
    let p = page.unwrap_or(1);
    let pp = per_page.unwrap_or(30).min(100);
    let data = client
        .get(&format!(
            "/user/repos?page={}&per_page={}&sort=updated&affiliation=owner,collaborator",
            p, pp
        ))
        .await?;

    let repos: Vec<Repo> = data
        .as_array()
        .map(|arr| arr.iter().map(parse_repo).collect())
        .unwrap_or_default();
    log::info!("[GitHub][Cmd] list_repos returned {} repos", repos.len());
    Ok(repos)
}

/// List branches for a repository.
#[command]
pub async fn github_list_branches(
    user_id: String,
    repo_full_name: String,
    hosted_service_url: String,
    hosted_token: String,
) -> Result<Vec<Branch>, String> {
    log::info!("[GitHub][Cmd] list_branches repo={}", repo_full_name);
    let client = make_client(&user_id, &hosted_service_url, &hosted_token);
    let data = client
        .get(&format!("/repos/{}/branches?per_page=100", repo_full_name))
        .await?;

    let branches: Vec<Branch> = data
        .as_array()
        .map(|arr| arr.iter().map(parse_branch).collect())
        .unwrap_or_default();
    log::info!(
        "[GitHub][Cmd] list_branches returned {} branches",
        branches.len()
    );
    Ok(branches)
}

/// Create a new branch from a given SHA.
#[command]
pub async fn github_create_branch(
    user_id: String,
    repo_full_name: String,
    branch_name: String,
    from_sha: String,
    hosted_service_url: String,
    hosted_token: String,
) -> Result<String, String> {
    log::info!(
        "[GitHub][Cmd] create_branch repo={} branch={}",
        repo_full_name,
        branch_name
    );
    let client = make_client(&user_id, &hosted_service_url, &hosted_token);
    let data = client
        .post(
            &format!("/repos/{}/git/refs", repo_full_name),
            json!({
                "ref": format!("refs/heads/{}", branch_name),
                "sha": from_sha
            }),
        )
        .await?;

    let sha = data["object"]["sha"].as_str().unwrap_or("").to_string();
    log::info!("[GitHub][Cmd] create_branch done sha={}", sha);
    Ok(sha)
}

/// Create a pull request.
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn github_create_pr(
    user_id: String,
    repo_full_name: String,
    title: String,
    head: String,
    base: String,
    body: Option<String>,
    draft: Option<bool>,
    hosted_service_url: String,
    hosted_token: String,
) -> Result<PRResponse, String> {
    log::info!(
        "[GitHub][Cmd] create_pr repo={} head={} base={}",
        repo_full_name,
        head,
        base
    );
    let client = make_client(&user_id, &hosted_service_url, &hosted_token);
    let data = client
        .post(
            &format!("/repos/{}/pulls", repo_full_name),
            json!({
                "title": title,
                "head": head,
                "base": base,
                "body": body.unwrap_or_default(),
                "draft": draft.unwrap_or(false)
            }),
        )
        .await?;

    let pr = PRResponse {
        number: data["number"].as_u64().unwrap_or(0),
        url: data["html_url"].as_str().unwrap_or("").to_string(),
    };
    log::info!("[GitHub][Cmd] create_pr done PR #{}", pr.number);
    Ok(pr)
}

/// Find a pull request for a head branch (open first, then all states).
#[command]
pub async fn github_find_pull_request(
    user_id: String,
    repo_full_name: String,
    head_branch: String,
    hosted_service_url: String,
    hosted_token: String,
) -> Result<Option<FindPRResponse>, String> {
    log::info!(
        "[GitHub][Cmd] find_pull_request repo={} head={}",
        repo_full_name,
        head_branch
    );
    let client = make_client(&user_id, &hosted_service_url, &hosted_token);
    let owner = repo_full_name
        .split('/')
        .next()
        .ok_or_else(|| format!("Invalid repo name: {}", repo_full_name))?;

    let parse_pr = |data: &Value| -> Option<FindPRResponse> {
        data.as_array()
            .and_then(|items| items.first())
            .map(|item| FindPRResponse {
                number: item["number"].as_u64().unwrap_or(0),
                url: item["html_url"].as_str().unwrap_or("").to_string(),
                state: item["state"].as_str().unwrap_or("open").to_string(),
            })
    };

    // Check open PRs first (most common path)
    let open_data = client
        .get(&format!(
            "/repos/{}/pulls?state=open&head={}:{}&per_page=1",
            repo_full_name, owner, head_branch
        ))
        .await?;

    if let Some(pr) = parse_pr(&open_data) {
        log::info!("[GitHub][Cmd] find_pull_request found open PR #{}", pr.number);
        return Ok(Some(pr));
    }

    // Fall back to all states to detect merged / closed PRs
    let all_data = client
        .get(&format!(
            "/repos/{}/pulls?state=all&head={}:{}&per_page=1",
            repo_full_name, owner, head_branch
        ))
        .await?;

    let pr = parse_pr(&all_data);
    log::info!(
        "[GitHub][Cmd] find_pull_request {}",
        match &pr {
            Some(p) => format!("found {} PR #{}", p.state, p.number),
            None => "not found".to_string(),
        }
    );
    Ok(pr)
}

/// Build the argv that `github_clone_repo` will pass to `git`.
///
/// Pulled out as a pure function so the unit tests below can assert that
/// (a) the OAuth token only ever appears inside the
/// `http.extraHeader=Authorization: Bearer …` config flag and never as a
/// CLI argument, in the URL, or anywhere else; and (b) `--depth 1` plus
/// `--branch <b> --single-branch` (when a branch is requested) are wired
/// correctly. Returns `OsString` so paths with non-UTF-8 components round
/// trip cleanly.
pub(crate) fn build_clone_argv(
    token: &str,
    repo_full_name: &str,
    target_dir: &Path,
    branch: Option<&str>,
) -> Vec<OsString> {
    let clean_url = format!("https://github.com/{}.git", repo_full_name);
    let mut argv: Vec<OsString> = Vec::with_capacity(8);
    argv.push("-c".into());
    argv.push(format!("http.extraHeader=Authorization: Bearer {}", token).into());
    argv.push("clone".into());
    argv.push("--depth".into());
    argv.push("1".into());
    if let Some(b) = branch {
        argv.push("--branch".into());
        argv.push(b.into());
        argv.push("--single-branch".into());
    }
    argv.push(clean_url.into());
    argv.push(target_dir.as_os_str().to_owned());
    argv
}

/// Format a clone-failure error string, redacting the token if `git`
/// happened to echo it back. Pulled out so the redaction logic is unit-
/// testable without spawning a subprocess.
pub(crate) fn clean_git_clone_error(token: &str, exit_code: Option<i32>, stderr: &[u8]) -> String {
    let stderr_str = String::from_utf8_lossy(stderr).replace(token, "***");
    format!(
        "git clone failed (exit {:?}): {}",
        exit_code,
        stderr_str.trim()
    )
}

#[command]
pub async fn github_git_credential_for_remote(
    user_id: String,
    remote_url: String,
) -> Result<Option<GitHubGitCredential>, String> {
    let Some(repo_full_name) = github_repo_full_name_from_remote(&remote_url) else {
        return Ok(None);
    };

    let Some(token) = token_store::get(&user_id)? else {
        return Ok(None);
    };

    Ok(Some(GitHubGitCredential {
        username: "x-access-token".to_string(),
        token,
        repo_full_name,
    }))
}

/// Clone a GitHub repository by shelling out to the system `git` CLI.
///
/// Why subprocess instead of libgit2:
/// - libgit2's HTTPS transport requires the `https` feature, which pulls
///   in `openssl-sys` + `openssl-src` (vendored OpenSSL build, ~1–2 GB of
///   C artifacts and a 30–60 s compile). ORGII already requires `git` on
///   PATH (every coding-agent flow assumes it; `git/bundle.rs` shells out
///   for `git bundle create`), so the in-process clone bought us nothing
///   except dep weight.
/// - The OAuth token is passed via `http.extraHeader` instead of being
///   embedded in the URL (`https://x-access-token:TOKEN@github.com/…`).
///   That keeps the token out of:
///   * the URL itself (libgit2 used to persist it as the `origin` remote
///     and we then had to overwrite it),
///   * `git`'s own log output and any inadvertent re-prints,
///   * the process command line visible in `ps` (the header is set
///     in-process via `-c` flags, not exported as an env var that other
///     subprocesses could read).
/// - `git` CLI auto-honors `~/.gitconfig`, `HTTP_PROXY`, system proxy
///   settings — strictly better proxy support than libgit2 had.
#[command]
pub async fn github_clone_repo(
    user_id: String,
    repo_full_name: String,
    target_dir: String,
    branch: Option<String>,
) -> Result<String, String> {
    log::info!(
        "[GitHub][Cmd] clone_repo repo={} target={}",
        repo_full_name,
        target_dir
    );
    let token = token_store::get(&user_id)?.ok_or("GitHubReAuthRequired: no token stored")?;

    let target = target_dir.clone();

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let argv = build_clone_argv(
            &token,
            &repo_full_name,
            Path::new(&target),
            branch.as_deref(),
        );

        let output = git_command()?
            .args(&argv)
            .output()
            .map_err(|e| format!("Failed to spawn bundled git clone: {}", e))?;

        if !output.status.success() {
            return Err(clean_git_clone_error(
                &token,
                output.status.code(),
                &output.stderr,
            ));
        }

        Ok(target)
    })
    .await
    .map_err(|e| format!("Clone task panicked: {}", e))?
}

/// Check if a GitHub token is stored and valid (GET /user).
#[command]
pub async fn github_check_token(
    user_id: String,
    hosted_service_url: String,
    hosted_token: String,
) -> Result<bool, String> {
    log::info!("[GitHub][Cmd] check_token user={}", user_id);
    let client = make_client(&user_id, &hosted_service_url, &hosted_token);
    match client.get("/user").await {
        Ok(_) => {
            log::info!("[GitHub][Cmd] check_token: valid");
            Ok(true)
        }
        Err(e) if e.contains("GitHubReAuthRequired") => {
            log::info!("[GitHub][Cmd] check_token: re-auth required");
            Ok(false)
        }
        Err(e) => Err(e),
    }
}

/// Clear the stored GitHub token (used on disconnect).
#[command]
pub async fn github_clear_token(user_id: String) -> Result<(), String> {
    token_store::clear(&user_id)?;
    log::info!("[GitHub] Token cleared for user {}", user_id);
    Ok(())
}

#[cfg(test)]
#[path = "tests/commands_tests.rs"]
mod tests;
