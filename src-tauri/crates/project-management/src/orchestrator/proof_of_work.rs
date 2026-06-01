//! Proof of work — collect and accumulate branch, PR, diff stats, cost, review feedback.

use crate::projects::types::{ProofOfWork, ReviewFeedback, WorkItemFrontmatter};

/// Ensure proof_of_work exists with defaults.
pub fn ensure_proof_of_work(frontmatter: &mut WorkItemFrontmatter) -> &mut ProofOfWork {
    frontmatter
        .proof_of_work
        .get_or_insert_with(|| ProofOfWork {
            branch: None,
            pr_url: None,
            pr_status: None,
            diff_stats: None,
            test_results: None,
            review_outcome: None,
            review_feedback: None,
            review_history: Vec::new(),
            total_cost_usd: 0.0,
            total_tokens: 0,
        })
}

/// Set the branch name in proof of work.
pub fn set_branch(frontmatter: &mut WorkItemFrontmatter, branch: &str) {
    let pow = ensure_proof_of_work(frontmatter);
    pow.branch = Some(branch.to_string());
}

/// Accumulate cost and token usage from a completed session.
pub fn accumulate_cost(frontmatter: &mut WorkItemFrontmatter, cost_usd: f64, tokens: u64) {
    let pow = ensure_proof_of_work(frontmatter);
    pow.total_cost_usd += cost_usd;
    pow.total_tokens += tokens;
}

/// Set the PR URL and status.
pub fn set_pr(
    frontmatter: &mut WorkItemFrontmatter,
    url: &str,
    status: crate::projects::types::PrStatus,
) {
    let pow = ensure_proof_of_work(frontmatter);
    pow.pr_url = Some(url.to_string());
    pow.pr_status = Some(status);
}

/// Set the review outcome.
pub fn set_review_outcome(
    frontmatter: &mut WorkItemFrontmatter,
    outcome: crate::projects::types::ReviewOutcome,
) {
    let pow = ensure_proof_of_work(frontmatter);
    pow.review_outcome = Some(outcome);
}

/// Set diff statistics with optional per-file breakdown.
pub fn set_diff_stats(
    frontmatter: &mut WorkItemFrontmatter,
    diff_stats: crate::projects::types::WorkItemDiffStats,
) {
    let pow = ensure_proof_of_work(frontmatter);
    pow.diff_stats = Some(diff_stats);
}

/// Record review feedback from the review agent's `submit_review` tool.
///
/// The latest feedback replaces `review_feedback` and the previous one (if any)
/// is pushed into `review_history`. Each review covers the full base..branch diff,
/// so the latest feedback supersedes all previous rounds.
pub fn set_review_feedback(frontmatter: &mut WorkItemFrontmatter, feedback: ReviewFeedback) {
    let pow = ensure_proof_of_work(frontmatter);
    pow.review_outcome = Some(feedback.outcome.clone());
    if let Some(previous) = pow.review_feedback.take() {
        pow.review_history.push(previous);
    }
    pow.review_feedback = Some(feedback);
}
