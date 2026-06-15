use super::{parse_git_artifacts, GitArtifactParseInput};
use crate::agent_sessions::event_pipeline::extractors::types::GitArtifactKind;

#[test]
fn parses_github_pr_url_from_gh_output() {
    let artifacts = parse_git_artifacts(GitArtifactParseInput {
        command: "gh pr create --title 'Add parser'",
        output: Some("https://github.com/orgii/app/pull/42\n"),
        exit_code: Some(0),
    });

    assert_eq!(artifacts.len(), 1);
    let artifact = &artifacts[0];
    assert_eq!(artifact.kind, GitArtifactKind::PullRequest);
    assert_eq!(artifact.repo_full_name.as_deref(), Some("orgii/app"));
    assert_eq!(artifact.pr_number, Some(42));
    assert_eq!(
        artifact.url.as_deref(),
        Some("https://github.com/orgii/app/pull/42")
    );
}

#[test]
fn parses_github_commit_url() {
    let artifacts = parse_git_artifacts(GitArtifactParseInput {
        command: "git push origin HEAD",
        output: Some("remote: https://github.com/orgii/app/commit/abcdef1234567890\n"),
        exit_code: Some(0),
    });

    assert_eq!(artifacts.len(), 1);
    let artifact = &artifacts[0];
    assert_eq!(artifact.kind, GitArtifactKind::Commit);
    assert_eq!(artifact.repo_full_name.as_deref(), Some("orgii/app"));
    assert_eq!(artifact.sha.as_deref(), Some("abcdef1234567890"));
    assert_eq!(artifact.short_sha.as_deref(), Some("abcdef1"));
}

#[test]
fn parses_successful_git_commit_output() {
    let artifacts = parse_git_artifacts(GitArtifactParseInput {
        command: "git commit -m 'Fix parser'",
        output: Some("[feature/git-cards abc1234] Fix parser\n 2 files changed, 10 insertions(+), 1 deletion(-)"),
        exit_code: Some(0),
    });

    assert_eq!(artifacts.len(), 1);
    let artifact = &artifacts[0];
    assert_eq!(artifact.kind, GitArtifactKind::Commit);
    assert_eq!(artifact.sha.as_deref(), Some("abc1234"));
    assert_eq!(artifact.short_sha.as_deref(), Some("abc1234"));
    assert_eq!(artifact.subject.as_deref(), Some("Fix parser"));
}

#[test]
fn ignores_git_log_oneline_commit_lists() {
    let artifacts = parse_git_artifacts(GitArtifactParseInput {
        command: "git log -5 --oneline",
        output: Some("abc1234 Fix parser\ndef5678 Previous commit"),
        exit_code: Some(0),
    });

    assert!(artifacts.is_empty());
}

#[test]
fn ignores_recent_commit_listing_commands() {
    let artifacts = parse_git_artifacts(GitArtifactParseInput {
        command: "git --no-pager log --pretty=oneline -10",
        output: Some("abcdef1234567890 Fix parser\n1234567890abcdef Add previous feature"),
        exit_code: Some(0),
    });

    assert!(artifacts.is_empty());
}

#[test]
fn ignores_git_rev_parse_head_boundary_queries() {
    let artifacts = parse_git_artifacts(GitArtifactParseInput {
        command: "git rev-parse HEAD",
        output: Some("abcdef1234567890abcdef1234567890abcdef12"),
        exit_code: Some(0),
    });

    assert!(artifacts.is_empty());
}

#[test]
fn ignores_failed_git_commands() {
    let artifacts = parse_git_artifacts(GitArtifactParseInput {
        command: "git commit -m 'Fix parser'",
        output: Some("[feature abc1234] Fix parser"),
        exit_code: Some(1),
    });

    assert!(artifacts.is_empty());
}

#[test]
fn deduplicates_same_pr_url() {
    let artifacts = parse_git_artifacts(GitArtifactParseInput {
        command: "gh pr create",
        output: Some("https://github.com/orgii/app/pull/42\nhttps://github.com/orgii/app/pull/42"),
        exit_code: Some(0),
    });

    assert_eq!(artifacts.len(), 1);
}
