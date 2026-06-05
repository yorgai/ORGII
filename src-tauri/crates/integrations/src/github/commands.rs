//! GitHub Tauri Commands
//!
//! Exposes GitHub operations to the frontend via `invoke()`. Credentials
//! are resolved at command entry from the centralized connection token
//! store (see `project_management::sync::git_credentials`); the frontend
//! no longer passes user IDs or hosted-service tokens.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::ffi::OsString;
use std::path::Path;
use tauri::command;

use git::git_command;
use project_management::sync::git_credentials::find_https_credential;

use super::client::GitHubClient;

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

/// Resolve the active HTTPS token, or return the canonical re-auth error.
fn resolve_token() -> Result<String, String> {
    match find_https_credential()? {
        Some(credential) => Ok(credential.token),
        None => Err("GitHubReAuthRequired: no git connection on file".to_string()),
    }
}

fn make_client() -> Result<GitHubClient, String> {
    Ok(GitHubClient::new(resolve_token()?))
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

#[command]
pub async fn github_list_repos(
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<Vec<Repo>, String> {
    log::info!("[GitHub][Cmd] list_repos page={page:?}");
    let client = make_client()?;
    let p = page.unwrap_or(1);
    let pp = per_page.unwrap_or(30).min(100);
    let data = client
        .get(&format!(
            "/user/repos?page={p}&per_page={pp}&sort=updated&affiliation=owner,collaborator"
        ))
        .await?;
    let repos: Vec<Repo> = data
        .as_array()
        .map(|arr| arr.iter().map(parse_repo).collect())
        .unwrap_or_default();
    log::info!("[GitHub][Cmd] list_repos returned {} repos", repos.len());
    Ok(repos)
}

#[command]
pub async fn github_list_branches(repo_full_name: String) -> Result<Vec<Branch>, String> {
    log::info!("[GitHub][Cmd] list_branches repo={repo_full_name}");
    let client = make_client()?;
    let data = client
        .get(&format!("/repos/{repo_full_name}/branches?per_page=100"))
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

#[command]
pub async fn github_create_branch(
    repo_full_name: String,
    branch_name: String,
    from_sha: String,
) -> Result<String, String> {
    log::info!("[GitHub][Cmd] create_branch repo={repo_full_name} branch={branch_name}");
    let client = make_client()?;
    let data = client
        .post(
            &format!("/repos/{repo_full_name}/git/refs"),
            json!({
                "ref": format!("refs/heads/{branch_name}"),
                "sha": from_sha
            }),
        )
        .await?;
    let sha = data["object"]["sha"].as_str().unwrap_or("").to_string();
    log::info!("[GitHub][Cmd] create_branch done sha={sha}");
    Ok(sha)
}

#[command]
pub async fn github_create_pr(
    repo_full_name: String,
    title: String,
    head: String,
    base: String,
    body: Option<String>,
    draft: Option<bool>,
) -> Result<PRResponse, String> {
    log::info!("[GitHub][Cmd] create_pr repo={repo_full_name} head={head} base={base}");
    let client = make_client()?;
    let data = client
        .post(
            &format!("/repos/{repo_full_name}/pulls"),
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

#[command]
pub async fn github_find_pull_request(
    repo_full_name: String,
    head_branch: String,
) -> Result<Option<FindPRResponse>, String> {
    log::info!("[GitHub][Cmd] find_pull_request repo={repo_full_name} head={head_branch}");
    let client = make_client()?;
    let owner = repo_full_name
        .split('/')
        .next()
        .ok_or_else(|| format!("Invalid repo name: {repo_full_name}"))?;

    let parse_pr = |data: &Value| -> Option<FindPRResponse> {
        data.as_array()
            .and_then(|items| items.first())
            .map(|item| FindPRResponse {
                number: item["number"].as_u64().unwrap_or(0),
                url: item["html_url"].as_str().unwrap_or("").to_string(),
                state: item["state"].as_str().unwrap_or("open").to_string(),
            })
    };

    let open_data = client
        .get(&format!(
            "/repos/{repo_full_name}/pulls?state=open&head={owner}:{head_branch}&per_page=1"
        ))
        .await?;
    if let Some(pr) = parse_pr(&open_data) {
        log::info!(
            "[GitHub][Cmd] find_pull_request found open PR #{}",
            pr.number
        );
        return Ok(Some(pr));
    }

    let all_data = client
        .get(&format!(
            "/repos/{repo_full_name}/pulls?state=all&head={owner}:{head_branch}&per_page=1"
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

#[command]
pub async fn github_get_pr(repo_full_name: String, pr_number: u64) -> Result<Value, String> {
    log::info!("[GitHub][Cmd] get_pr repo={repo_full_name} pr={pr_number}");
    let client = make_client()?;
    client
        .get(&format!("/repos/{repo_full_name}/pulls/{pr_number}"))
        .await
}

#[command]
pub async fn github_list_pr_commits(
    repo_full_name: String,
    pr_number: u64,
) -> Result<Value, String> {
    log::info!("[GitHub][Cmd] list_pr_commits repo={repo_full_name} pr={pr_number}");
    let client = make_client()?;
    client
        .get(&format!(
            "/repos/{repo_full_name}/pulls/{pr_number}/commits?per_page=100"
        ))
        .await
}

#[command]
pub async fn github_list_pr_files(repo_full_name: String, pr_number: u64) -> Result<Value, String> {
    log::info!("[GitHub][Cmd] list_pr_files repo={repo_full_name} pr={pr_number}");
    let client = make_client()?;
    client
        .get(&format!(
            "/repos/{repo_full_name}/pulls/{pr_number}/files?per_page=300"
        ))
        .await
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
    let clean_url = format!("https://github.com/{repo_full_name}.git");
    let mut argv: Vec<OsString> = Vec::with_capacity(8);
    argv.push("-c".into());
    argv.push(format!("http.extraHeader=Authorization: Bearer {token}").into());
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
        "git clone failed (exit {exit_code:?}): {}",
        stderr_str.trim()
    )
}

#[command]
pub async fn github_git_credential_for_remote(
    remote_url: String,
) -> Result<Option<GitHubGitCredential>, String> {
    let Some(repo_full_name) = github_repo_full_name_from_remote(&remote_url) else {
        return Ok(None);
    };
    let Some(credential) = find_https_credential()? else {
        return Ok(None);
    };
    Ok(Some(GitHubGitCredential {
        username: credential.username,
        token: credential.token,
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
///   * the URL itself,
///   * `git`'s own log output and any inadvertent re-prints,
///   * the process command line visible in `ps`.
/// - `git` CLI auto-honors `~/.gitconfig`, `HTTP_PROXY`, system proxy
///   settings — strictly better proxy support than libgit2 had.
#[command]
pub async fn github_clone_repo(
    repo_full_name: String,
    target_dir: String,
    branch: Option<String>,
) -> Result<String, String> {
    log::info!("[GitHub][Cmd] clone_repo repo={repo_full_name} target={target_dir}");
    let token = resolve_token()?;
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
            .map_err(|err| format!("Failed to spawn bundled git clone: {err}"))?;
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
    .map_err(|err| format!("Clone task panicked: {err}"))?
}

/// Check whether a GitHub token is on file and accepted by `GET /user`.
#[command]
pub async fn github_check_token() -> Result<bool, String> {
    log::info!("[GitHub][Cmd] check_token");
    let client = match make_client() {
        Ok(client) => client,
        Err(err) if err.contains("GitHubReAuthRequired") => return Ok(false),
        Err(err) => return Err(err),
    };
    match client.get("/user").await {
        Ok(_) => Ok(true),
        Err(err) if err.contains("GitHubReAuthRequired") => Ok(false),
        Err(err) => Err(err),
    }
}

// ============================================
// Issues
// ============================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueLabel {
    pub id: u64,
    pub name: String,
    pub color: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueUser {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubIssue {
    pub number: u64,
    pub title: String,
    pub body: Option<String>,
    pub state: String,
    pub state_reason: Option<String>,
    pub html_url: String,
    pub created_at: String,
    pub updated_at: String,
    pub closed_at: Option<String>,
    pub user: IssueUser,
    pub labels: Vec<IssueLabel>,
    pub assignees: Vec<IssueUser>,
    pub comments: u64,
    pub milestone: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitHubIssueComment {
    pub id: u64,
    pub body: String,
    pub user: IssueUser,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Debug, Serialize)]
pub struct GitHubIssueListResponse {
    pub issues: Vec<GitHubIssue>,
    pub total_count: u64,
    pub has_more: bool,
}

fn parse_issue_user(v: &Value) -> IssueUser {
    IssueUser {
        login: v["login"].as_str().unwrap_or("").to_string(),
        avatar_url: v["avatar_url"].as_str().unwrap_or("").to_string(),
    }
}

fn parse_issue_label(v: &Value) -> IssueLabel {
    IssueLabel {
        id: v["id"].as_u64().unwrap_or(0),
        name: v["name"].as_str().unwrap_or("").to_string(),
        color: v["color"].as_str().unwrap_or("").to_string(),
        description: v["description"].as_str().map(|s| s.to_string()),
    }
}

fn parse_issue(v: &Value) -> GitHubIssue {
    GitHubIssue {
        number: v["number"].as_u64().unwrap_or(0),
        title: v["title"].as_str().unwrap_or("").to_string(),
        body: v["body"].as_str().map(|s| s.to_string()),
        state: v["state"].as_str().unwrap_or("open").to_string(),
        state_reason: v["state_reason"].as_str().map(|s| s.to_string()),
        html_url: v["html_url"].as_str().unwrap_or("").to_string(),
        created_at: v["created_at"].as_str().unwrap_or("").to_string(),
        updated_at: v["updated_at"].as_str().unwrap_or("").to_string(),
        closed_at: v["closed_at"].as_str().map(|s| s.to_string()),
        user: parse_issue_user(&v["user"]),
        labels: v["labels"]
            .as_array()
            .map(|arr| arr.iter().map(parse_issue_label).collect())
            .unwrap_or_default(),
        assignees: v["assignees"]
            .as_array()
            .map(|arr| arr.iter().map(parse_issue_user).collect())
            .unwrap_or_default(),
        comments: v["comments"].as_u64().unwrap_or(0),
        milestone: v["milestone"]["title"].as_str().map(|s| s.to_string()),
    }
}

fn parse_issue_comment(v: &Value) -> GitHubIssueComment {
    GitHubIssueComment {
        id: v["id"].as_u64().unwrap_or(0),
        body: v["body"].as_str().unwrap_or("").to_string(),
        user: parse_issue_user(&v["user"]),
        created_at: v["created_at"].as_str().unwrap_or("").to_string(),
        updated_at: v["updated_at"].as_str().unwrap_or("").to_string(),
        html_url: v["html_url"].as_str().unwrap_or("").to_string(),
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn github_list_issues(
    repo_full_name: String,
    state: Option<String>,
    labels: Option<String>,
    assignee: Option<String>,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<GitHubIssueListResponse, String> {
    log::info!("[GitHub][Cmd] list_issues repo={repo_full_name} state={state:?}");
    let client = make_client()?;
    let per_page = per_page.unwrap_or(30);
    let page = page.unwrap_or(1);
    let state_str = state.as_deref().unwrap_or("open");
    let mut url = format!(
        "/repos/{repo_full_name}/issues?state={state_str}&per_page={per_page}&page={page}&filter=all"
    );
    if let Some(l) = &labels {
        url.push_str(&format!("&labels={l}"));
    }
    if let Some(a) = &assignee {
        url.push_str(&format!("&assignee={a}"));
    }
    let result = client.get(&url).await.map_err(|e| e.to_string())?;
    let issues: Vec<GitHubIssue> = result
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|v| v["pull_request"].is_null())
                .map(parse_issue)
                .collect()
        })
        .unwrap_or_default();
    let has_more = issues.len() >= per_page as usize;
    Ok(GitHubIssueListResponse {
        total_count: issues.len() as u64,
        issues,
        has_more,
    })
}

#[tauri::command]
pub async fn github_get_issue(
    repo_full_name: String,
    issue_number: u64,
) -> Result<GitHubIssue, String> {
    log::info!("[GitHub][Cmd] get_issue repo={repo_full_name} issue={issue_number}");
    let client = make_client()?;
    let result = client
        .get(&format!("/repos/{repo_full_name}/issues/{issue_number}"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_issue(&result))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn github_create_issue(
    repo_full_name: String,
    title: String,
    body: Option<String>,
    labels: Option<Vec<String>>,
    assignees: Option<Vec<String>>,
) -> Result<GitHubIssue, String> {
    log::info!("[GitHub][Cmd] create_issue repo={repo_full_name} title={title}");
    let client = make_client()?;
    let mut payload = serde_json::json!({ "title": title });
    if let Some(b) = body {
        payload["body"] = serde_json::json!(b);
    }
    if let Some(l) = labels {
        payload["labels"] = serde_json::json!(l);
    }
    if let Some(a) = assignees {
        payload["assignees"] = serde_json::json!(a);
    }
    let result = client
        .post(&format!("/repos/{repo_full_name}/issues"), payload)
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_issue(&result))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn github_update_issue(
    repo_full_name: String,
    issue_number: u64,
    title: Option<String>,
    body: Option<String>,
    state: Option<String>,
    state_reason: Option<String>,
    labels: Option<Vec<String>>,
    assignees: Option<Vec<String>>,
) -> Result<GitHubIssue, String> {
    log::info!("[GitHub][Cmd] update_issue repo={repo_full_name} issue={issue_number}");
    let client = make_client()?;
    let mut payload = serde_json::json!({});
    if let Some(t) = title {
        payload["title"] = serde_json::json!(t);
    }
    if let Some(b) = body {
        payload["body"] = serde_json::json!(b);
    }
    if let Some(s) = state {
        payload["state"] = serde_json::json!(s);
    }
    if let Some(sr) = state_reason {
        payload["state_reason"] = serde_json::json!(sr);
    }
    if let Some(l) = labels {
        payload["labels"] = serde_json::json!(l);
    }
    if let Some(a) = assignees {
        payload["assignees"] = serde_json::json!(a);
    }
    let result = client
        .patch(
            &format!("/repos/{repo_full_name}/issues/{issue_number}"),
            payload,
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_issue(&result))
}

#[tauri::command]
pub async fn github_list_issue_comments(
    repo_full_name: String,
    issue_number: u64,
    page: Option<u32>,
    per_page: Option<u32>,
) -> Result<Vec<GitHubIssueComment>, String> {
    log::info!("[GitHub][Cmd] list_issue_comments repo={repo_full_name} issue={issue_number}");
    let client = make_client()?;
    let per_page = per_page.unwrap_or(50);
    let page = page.unwrap_or(1);
    let result = client
        .get(&format!(
            "/repos/{repo_full_name}/issues/{issue_number}/comments?per_page={per_page}&page={page}"
        ))
        .await
        .map_err(|e| e.to_string())?;
    Ok(result
        .as_array()
        .map(|arr| arr.iter().map(parse_issue_comment).collect())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn github_create_issue_comment(
    repo_full_name: String,
    issue_number: u64,
    body: String,
) -> Result<GitHubIssueComment, String> {
    log::info!("[GitHub][Cmd] create_issue_comment repo={repo_full_name} issue={issue_number}");
    let client = make_client()?;
    let payload = serde_json::json!({ "body": body });
    let result = client
        .post(
            &format!("/repos/{repo_full_name}/issues/{issue_number}/comments"),
            payload,
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_issue_comment(&result))
}

#[tauri::command]
pub async fn github_list_repo_labels(repo_full_name: String) -> Result<Vec<IssueLabel>, String> {
    log::info!("[GitHub][Cmd] list_repo_labels repo={repo_full_name}");
    let client = make_client()?;
    let result = client
        .get(&format!("/repos/{repo_full_name}/labels?per_page=100"))
        .await
        .map_err(|e| e.to_string())?;
    Ok(result
        .as_array()
        .map(|arr| arr.iter().map(parse_issue_label).collect())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn github_list_repo_collaborators(
    repo_full_name: String,
) -> Result<Vec<IssueUser>, String> {
    log::info!("[GitHub][Cmd] list_repo_collaborators repo={repo_full_name}");
    let client = make_client()?;
    let result = client
        .get(&format!(
            "/repos/{repo_full_name}/collaborators?per_page=100"
        ))
        .await
        .map_err(|e| e.to_string())?;
    Ok(result
        .as_array()
        .map(|arr| arr.iter().map(parse_issue_user).collect())
        .unwrap_or_default())
}

#[cfg(test)]
#[path = "tests/commands_tests.rs"]
mod tests;
