use super::staging::{stage_all_files, stage_file};
use super::utils::{get_current_branch, run_git};
use crate::types::*;
/**
 * Commit Operations
 *
 * Create commits, list commits, amend commits.
 * All operations use retry logic for transient errors.
 */
use std::path::Path;

/// Get commit history
///
/// If `file_path` is provided, only returns commits that modified that file.
/// This is equivalent to `git log -- <file_path>` (like VSCode Timeline).
pub fn list_commits(
    repo_path: &Path,
    limit: Option<u32>,
    skip: Option<u32>,
    file_path: Option<&str>,
) -> Result<GitCommitsData, String> {
    let limit_str = format!("-{}", limit.unwrap_or(50));
    let skip_str = skip.map(|s| format!("--skip={}", s));

    // Format: Use %x1e (record separator) between commits for reliable parsing
    // Fields within a commit are separated by %x1f (unit separator)
    // Body may contain pipes, so we use special delimiters
    let format_arg =
        "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1f%b%x1f%P%x1e";

    // Store file_path as owned String for lifetime
    let file_filter: String = file_path.unwrap_or("").to_string();

    // Build git log command
    let mut args = vec!["log", &limit_str, format_arg];

    // Add skip for pagination
    if let Some(ref skip_arg) = skip_str {
        args.push(skip_arg);
    }

    // Add file path filter if provided (like VSCode Timeline)
    // This uses git's pathspec to filter commits that touched the file
    if file_path.is_some() && !file_filter.is_empty() {
        args.push("--");
        args.push(&file_filter);
    }

    let output = run_git(repo_path, &args)?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();

    // Split by record separator (0x1e)
    for entry in stdout.split('\x1e') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }

        // Split fields by unit separator (0x1f)
        let parts: Vec<&str> = entry.split('\x1f').collect();
        if parts.len() < 11 {
            log::warn!(
                "[list_commits] Skipping malformed entry with {} parts",
                parts.len()
            );
            continue;
        }

        let sha = parts[0].trim().to_string();
        let short_sha = parts[1].trim().to_string();
        let author_name = parts[2].to_string();
        let author_email = parts[3].to_string();
        let author_date = parts[4].to_string();
        let committer_name = parts[5].to_string();
        let committer_email = parts[6].to_string();
        let committer_date = parts[7].to_string();
        let summary = parts[8].to_string();
        let body = parts[9].trim().to_string();
        let parent_shas: Vec<String> = parts[10]
            .split_whitespace()
            .map(|p| p.to_string())
            .collect();

        commits.push(GitCommitInfo {
            sha,
            short_sha,
            summary,
            body,
            author: GitCommitAuthor {
                name: author_name,
                email: author_email,
                date: author_date,
            },
            committer: GitCommitAuthor {
                name: committer_name,
                email: committer_email,
                date: committer_date,
            },
            parent_shas,
        });
    }

    Ok(GitCommitsData {
        commits,
        total_count: None,
    })
}

/// Create a commit
pub fn create_commit(
    repo_path: &Path,
    message: &str,
    description: Option<&str>,
    stage_all: bool,
    files: Option<&[String]>,
) -> Result<String, String> {
    // Stage files if needed
    if stage_all {
        stage_all_files(repo_path)?;
    } else if let Some(file_list) = files {
        for file in file_list {
            stage_file(repo_path, file)?;
        }
    }

    // Build commit message
    let full_message = if let Some(desc) = description {
        format!("{}\n\n{}", message, desc)
    } else {
        message.to_string()
    };

    // Create commit
    let output = run_git(repo_path, &["commit", "-m", &full_message])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // Get the new commit sha
    let sha_output = run_git(repo_path, &["rev-parse", "HEAD"])?;

    Ok(String::from_utf8_lossy(&sha_output.stdout)
        .trim()
        .to_string())
}

/// Get local (unpushed) commits
pub fn get_local_commits(repo_path: &Path, branch: Option<&str>) -> Result<GitCommitsData, String> {
    let branch_name = match branch {
        Some(b) => b.to_string(),
        None => get_current_branch(repo_path)?,
    };

    // Get upstream tracking branch
    let upstream_ref = format!("{}@{{upstream}}", branch_name);
    let upstream = match run_git(repo_path, &["rev-parse", "--abbrev-ref", &upstream_ref]) {
        Ok(output) if output.status.success() => {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
        _ => {
            // No upstream, return empty
            return Ok(GitCommitsData {
                commits: vec![],
                total_count: Some(0),
            });
        }
    };

    // Get commits that are in local but not in upstream
    let range = format!("{}..{}", upstream, branch_name);

    // Use the same format as list_commits for consistency
    let format_str = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1f%b%x1f%P%x1e";

    let output = run_git(
        repo_path,
        &["log", &range, &format!("--format={}", format_str)],
    )?;

    if !output.status.success() {
        return Ok(GitCommitsData {
            commits: vec![],
            total_count: Some(0),
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();

    // Split by record separator (0x1e)
    for entry in stdout.split('\x1e') {
        let entry = entry.trim();
        if entry.is_empty() {
            continue;
        }

        // Split fields by unit separator (0x1f)
        let parts: Vec<&str> = entry.split('\x1f').collect();
        if parts.len() < 11 {
            continue;
        }

        let sha = parts[0].trim().to_string();
        let short_sha = parts[1].trim().to_string();
        let author_name = parts[2].to_string();
        let author_email = parts[3].to_string();
        let author_date = parts[4].to_string();
        let committer_name = parts[5].to_string();
        let committer_email = parts[6].to_string();
        let committer_date = parts[7].to_string();
        let summary = parts[8].to_string();
        let body = parts[9].trim().to_string();
        let parent_shas: Vec<String> = parts[10]
            .split_whitespace()
            .map(|p| p.to_string())
            .collect();

        commits.push(GitCommitInfo {
            sha,
            short_sha,
            summary,
            body,
            author: GitCommitAuthor {
                name: author_name,
                email: author_email,
                date: author_date,
            },
            committer: GitCommitAuthor {
                name: committer_name,
                email: committer_email,
                date: committer_date,
            },
            parent_shas,
        });
    }

    let count = commits.len() as u32;
    Ok(GitCommitsData {
        commits,
        total_count: Some(count),
    })
}

/// Amend last commit
pub fn amend_commit(
    repo_path: &Path,
    message: Option<&str>,
    files: Option<&[String]>,
) -> Result<GitCommitInfo, String> {
    // Stage files if provided
    if let Some(file_list) = files {
        for file in file_list {
            stage_file(repo_path, file)?;
        }
    }

    let mut args = vec!["commit", "--amend"];

    if let Some(msg) = message {
        args.push("-m");
        args.push(msg);
    } else {
        args.push("--no-edit");
    }

    let output = run_git(repo_path, &args)?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    // Get the amended commit info
    let commits = list_commits(repo_path, Some(1), None, None)?;
    commits
        .commits
        .into_iter()
        .next()
        .ok_or_else(|| "Failed to get amended commit".to_string())
}
