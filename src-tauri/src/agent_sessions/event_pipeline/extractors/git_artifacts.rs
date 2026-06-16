use std::collections::HashSet;
use std::sync::LazyLock;

use regex::Regex;

use crate::agent_sessions::event_pipeline::extractors::types::{
    ExtractedGitArtifactData, GitArtifactKind,
};

static GIT_COMMAND_CONTEXT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(^|[;&|()\s])(git|gh)(\s|$)").expect("valid git command context regex")
});
static GITHUB_PR_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"https?://github\.com/([^\s/]+)/([^\s/]+)/pull/(\d+)(?:[^\s<>\"'`)\]}]*)?"#)
        .expect("valid GitHub PR URL regex")
});
static GITHUB_COMMIT_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"https?://github\.com/([^\s/]+)/([^\s/]+)/commit/([0-9a-fA-F]{7,40})(?:[^\s<>\"'`)\]}]*)?"#)
        .expect("valid GitHub commit URL regex")
});
static GIT_COMMIT_OUTPUT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^\[(?P<prefix>.+)\s(?P<sha>[0-9a-fA-F]{7,40})\]\s(?P<subject>.+)$")
        .expect("valid git commit output regex")
});
static GIT_PUSH_SUMMARY_RE: LazyLock<Regex> = LazyLock::new(|| {
    // Matches a `git push` summary line whose left column carries an
    // `<old>..<new>` (fast-forward) or `<old>...<new>` (forced) SHA range,
    // e.g. `   cd8b555..ffd4927  Dev -> Dev` or
    // ` + 1234abc...def5678  feature -> feature (forced update)`. New-branch
    // / deleted rows have no SHA range and are intentionally skipped.
    Regex::new(
        r"(?m)^\s+[-+*!]?\s*([0-9a-fA-F]{7,40})\.\.+([0-9a-fA-F]{7,40})\s+\S+\s*->\s*\S+",
    )
    .expect("valid git push summary regex")
});
pub struct GitArtifactParseInput<'a> {
    pub command: &'a str,
    pub output: Option<&'a str>,
    pub exit_code: Option<i64>,
}

pub fn parse_git_artifacts(input: GitArtifactParseInput<'_>) -> Vec<ExtractedGitArtifactData> {
    if input.exit_code.is_some_and(|code| code != 0) {
        return Vec::new();
    }
    if !GIT_COMMAND_CONTEXT_RE.is_match(input.command) {
        return Vec::new();
    }

    let output = input.output.unwrap_or_default();
    let mut artifacts = Vec::new();
    let mut seen = HashSet::new();

    collect_pr_urls(output, &mut artifacts, &mut seen);
    collect_commit_urls(output, &mut artifacts, &mut seen);
    collect_commit_output(input.command, output, &mut artifacts, &mut seen);
    collect_push_output(output, &mut artifacts, &mut seen);

    artifacts
}

fn collect_pr_urls(
    output: &str,
    artifacts: &mut Vec<ExtractedGitArtifactData>,
    seen: &mut HashSet<String>,
) {
    for captures in GITHUB_PR_URL_RE.captures_iter(output) {
        let owner = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
        let repo = captures.get(2).map(|m| m.as_str()).unwrap_or_default();
        let number = captures.get(3).and_then(|m| m.as_str().parse::<u64>().ok());
        let repo_full_name = format!("{owner}/{repo}");
        let Some(pr_number) = number else { continue };
        let key = format!("pr:{repo_full_name}#{pr_number}");
        if !seen.insert(key) {
            continue;
        }
        artifacts.push(ExtractedGitArtifactData {
            kind: GitArtifactKind::PullRequest,
            url: Some(format!(
                "https://github.com/{repo_full_name}/pull/{pr_number}"
            )),
            repo_full_name: Some(repo_full_name),
            sha: None,
            short_sha: None,
            subject: None,
            pr_number: Some(pr_number),
            pr_title: None,
            source_branch: None,
            target_branch: None,
        });
    }
}

fn collect_commit_urls(
    output: &str,
    artifacts: &mut Vec<ExtractedGitArtifactData>,
    seen: &mut HashSet<String>,
) {
    for captures in GITHUB_COMMIT_URL_RE.captures_iter(output) {
        let owner = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
        let repo = captures.get(2).map(|m| m.as_str()).unwrap_or_default();
        let sha = captures
            .get(3)
            .map(|m| m.as_str().to_ascii_lowercase())
            .unwrap_or_default();
        let repo_full_name = format!("{owner}/{repo}");
        let key = format!("commit:{repo_full_name}@{sha}");
        if !seen.insert(key) {
            continue;
        }
        artifacts.push(ExtractedGitArtifactData {
            kind: GitArtifactKind::Commit,
            url: Some(format!("https://github.com/{repo_full_name}/commit/{sha}")),
            repo_full_name: Some(repo_full_name),
            sha: Some(sha.clone()),
            short_sha: Some(short_sha(&sha)),
            subject: None,
            pr_number: None,
            pr_title: None,
            source_branch: None,
            target_branch: None,
        });
    }
}

fn collect_commit_output(
    command: &str,
    output: &str,
    artifacts: &mut Vec<ExtractedGitArtifactData>,
    seen: &mut HashSet<String>,
) {
    if !command_mentions_git_subcommand(command, "commit") {
        return;
    }
    for captures in GIT_COMMIT_OUTPUT_RE.captures_iter(output) {
        let sha = captures
            .name("sha")
            .map(|m| m.as_str().to_ascii_lowercase())
            .unwrap_or_default();
        let subject = captures
            .name("subject")
            .map(|m| m.as_str().trim().to_string())
            .filter(|value| !value.is_empty());
        let key = format!("commit:local@{sha}");
        if !seen.insert(key) {
            continue;
        }
        artifacts.push(ExtractedGitArtifactData {
            kind: GitArtifactKind::Commit,
            url: None,
            repo_full_name: None,
            sha: Some(sha.clone()),
            short_sha: Some(short_sha(&sha)),
            subject,
            pr_number: None,
            pr_title: None,
            source_branch: None,
            target_branch: None,
        });
    }
}

fn command_mentions_git_subcommand(command: &str, subcommand: &str) -> bool {
    command
        .split(|ch: char| ch.is_whitespace() || matches!(ch, ';' | '&' | '|'))
        .collect::<Vec<_>>()
        .windows(2)
        .any(|pair| pair[0] == "git" && pair[1] == subcommand)
}

fn collect_push_output(
    output: &str,
    artifacts: &mut Vec<ExtractedGitArtifactData>,
    seen: &mut HashSet<String>,
) {
    for captures in GIT_PUSH_SUMMARY_RE.captures_iter(output) {
        let _old_sha = captures.get(1).map(|m| m.as_str()).unwrap_or_default();
        let new_sha = captures
            .get(2)
            .map(|m| m.as_str().to_ascii_lowercase())
            .unwrap_or_default();
        if new_sha.is_empty() {
            continue;
        }
        let key = format!("commit:push@{new_sha}");
        if !seen.insert(key) {
            continue;
        }
        artifacts.push(ExtractedGitArtifactData {
            kind: GitArtifactKind::Commit,
            url: None,
            repo_full_name: None,
            sha: Some(new_sha.clone()),
            short_sha: Some(short_sha(&new_sha)),
            subject: None,
            pr_number: None,
            pr_title: None,
            source_branch: None,
            target_branch: None,
        });
    }
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

#[cfg(test)]
#[path = "tests/git_artifacts_tests.rs"]
mod tests;
