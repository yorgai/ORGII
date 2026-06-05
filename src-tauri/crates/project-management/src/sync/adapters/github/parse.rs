//! Pure mapping helpers between GitHub Issue REST shape and the
//! adapter's canonical wire types ([`super::super::super::adapter::ExternalChange`]
//! and the `IssueUpdate` body sent on push).
//!
//! Kept in its own module so it's testable without spinning up an
//! HTTP server: every function is `Value -> Value` or
//! `Value -> ExternalChange`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::sync::adapter::ExternalChange;
use crate::sync::types::{EntityType, OutboxEntry, OutboxOp};

/// Connection config persisted in `projects.sync_config_json` for
/// `github`. The adapter requires both `owner` and `repo` —
/// neither has a sensible default. Multi-repo per project is not
/// supported; future iterations could extend this to a list of repos.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubConfig {
    pub owner: String,
    pub repo: String,
}

impl GitHubConfig {
    /// Parse `sync_config_json` into the typed config. Returns a
    /// human-readable error so the resulting [`super::super::super::types::SyncError::Permanent`]
    /// surfaces in project sync status with enough context.
    pub fn parse(raw: Option<&str>) -> Result<Self, String> {
        let raw =
            raw.ok_or_else(|| "github requires sync_config_json with { owner, repo }".to_string())?;
        let parsed: GitHubConfig = serde_json::from_str(raw)
            .map_err(|err| format!("github config not valid JSON: {}", err))?;
        if parsed.owner.is_empty() || parsed.repo.is_empty() {
            return Err("github config has empty owner/repo".to_string());
        }
        Ok(parsed)
    }
}

/// Translate one GitHub Issue JSON object into an [`ExternalChange`].
///
/// Returns `Err` when the object is shaped wrong (missing `number`,
/// `updated_at`, …) — caller should classify that as
/// [`super::super::super::types::SyncError::Permanent`] so the
/// worker abandons the row instead of retrying forever.
///
/// GitHub's Issues API also returns pull requests when listed via
/// `/issues` — callers should pre-filter on `pull_request` being
/// absent so we don't sync PRs as work items.
pub fn parse_github_issue(node: &Value) -> Result<ExternalChange, String> {
    let number = node
        .get("number")
        .and_then(Value::as_i64)
        .ok_or_else(|| "GitHub issue missing number".to_string())?;
    let external_id = number.to_string();

    let updated_at_str = node
        .get("updated_at")
        .and_then(Value::as_str)
        .ok_or_else(|| "GitHub issue missing updated_at".to_string())?;
    let remote_updated_at: DateTime<Utc> = updated_at_str.parse().map_err(|err| {
        format!(
            "GitHub updated_at unparseable ({}): {}",
            updated_at_str, err
        )
    })?;

    // Closed-and-archived doesn't exist as a separate state — but a
    // closed issue with `state_reason: "not_planned"` is the closest
    // analog to a soft delete. Leave both cases as `deleted=false`
    // and let the resolver translate `state` instead — that keeps
    // the contract symmetric with parse → push.
    let deleted = false;

    let mut fields = Map::new();
    if let Some(title) = node.get("title").and_then(Value::as_str) {
        fields.insert("title".to_string(), json!(title));
    }
    if let Some(body) = node.get("body") {
        // Body can legitimately be null on freshly-created issues;
        // pass it through so the resolver can decide whether to
        // overwrite a local body or skip.
        fields.insert("body".to_string(), body.clone());
    }
    if let Some(state) = node.get("state").and_then(Value::as_str) {
        fields.insert("status".to_string(), json!(state));
    }
    if let Some(assignees) = node.get("assignees").and_then(Value::as_array) {
        // Multiple assignees collapse to the first; full multi-assignee
        // support is a resolver concern (local schema is
        // single-assignee). Empty array → no assignee.
        if let Some(first) = assignees
            .iter()
            .filter_map(|a| a.get("login").and_then(Value::as_str))
            .next()
        {
            fields.insert("assignee".to_string(), json!(first));
        }
    }
    if let Some(label_nodes) = node.get("labels").and_then(Value::as_array) {
        let labels: Vec<Value> = label_nodes
            .iter()
            .filter_map(|n| n.get("name").and_then(Value::as_str))
            .map(|name| json!(name))
            .collect();
        fields.insert("labels".to_string(), Value::Array(labels));
    }
    if let Some(milestone_title) = node.pointer("/milestone/title").and_then(Value::as_str) {
        fields.insert("milestone".to_string(), json!(milestone_title));
    }

    Ok(ExternalChange {
        entity_type: EntityType::WorkItem,
        external_id,
        // Identity-mapping is the resolver's job; pull rows surface
        // here and the resolver matches by `external_id` ↔
        // `workitem_extras` mapping at apply time.
        local_entity_id: None,
        fields: Value::Object(fields),
        remote_updated_at,
        deleted,
    })
}

/// Pull requests come back from `/issues` with a `pull_request`
/// object attached. The Issues sync framework only cares about real
/// issues — callers use this to skip PRs.
pub fn is_pull_request(node: &Value) -> bool {
    node.get("pull_request")
        .map(|v| !v.is_null())
        .unwrap_or(false)
}

/// Build the JSON body for `PATCH /repos/{owner}/{repo}/issues/{n}`.
///
/// Mirrors `parse_github_issue` symmetrically: only fields we know
/// how to write are emitted, and `null` values are skipped so
/// missing/unset locals don't accidentally clear remote fields.
pub fn build_issue_update_body(local: &Value) -> Value {
    let mut body = Map::new();
    if let Some(title) = local.get("title").and_then(Value::as_str) {
        body.insert("title".to_string(), json!(title));
    }
    if let Some(value) = local.get("body") {
        if !value.is_null() {
            body.insert("body".to_string(), value.clone());
        }
    }
    if let Some(status) = local.get("status").and_then(Value::as_str) {
        // Only `open` / `closed` are valid GitHub states; anything
        // else gets dropped so we don't 422 the API.
        if matches!(status, "open" | "closed") {
            body.insert("state".to_string(), json!(status));
        }
    }
    if let Some(labels_value) = local.get("labels") {
        if let Some(labels) = labels_value.as_array() {
            // GitHub expects an array of strings on update; pass the
            // names through as-is.
            let names: Vec<Value> = labels
                .iter()
                .filter_map(|v| v.as_str().map(|s| json!(s)))
                .collect();
            body.insert("labels".to_string(), Value::Array(names));
        }
    }
    if let Some(milestone) = local.get("milestone") {
        // Milestones in REST are referenced by integer id, not title.
        // We accept either: an integer payload writes through; a
        // string payload (typical when the resolver sends the title)
        // is dropped here so the user gets a "unsupported field"
        // experience rather than a 422 from GitHub.
        if let Some(id) = milestone.as_i64() {
            body.insert("milestone".to_string(), json!(id));
        }
    }
    Value::Object(body)
}

/// Build the JSON body for `POST /repos/{owner}/{repo}/issues`.
/// Title is required by GitHub; everything else is optional.
pub fn build_issue_create_body(local: &Value) -> Result<Value, String> {
    let title = local
        .get("title")
        .and_then(Value::as_str)
        .ok_or_else(|| "github create payload missing required title".to_string())?;
    // Reuse build_issue_update_body for the optional fields, then
    // patch in `title` so the contract stays in one place.
    let mut body = build_issue_update_body(local);
    if let Some(obj) = body.as_object_mut() {
        obj.insert("title".to_string(), json!(title));
        // `state` doesn't apply to creates — issues always start `open`.
        obj.remove("state");
    }
    Ok(body)
}

/// Build the JSON body for "delete" (close as not_planned).
pub fn build_issue_close_body() -> Value {
    json!({
        "state": "closed",
        "state_reason": "not_planned",
    })
}

/// Parse a GitHub webhook envelope into [`ExternalChange`]
/// rows.
///
/// GitHub fans the `issues` event over many actions
/// (`opened`, `edited`, `closed`, `reopened`, `deleted`, `labeled`,
/// `unlabeled`, `assigned`, `unassigned`, `milestoned`,
/// `demilestoned`, `pinned`, `unpinned`, `transferred`); for the
/// purposes of one-way state mirroring we treat all of them as
/// "the issue body is now the source of truth" and re-parse it.
/// `deleted` flips the soft-delete flag.
///
/// Comment events (`issue_comment`) are silently dropped — comments
/// don't currently map to local entities. Anything without an `issue`
/// field is similarly dropped so new event types don't 4xx the listener.
pub fn parse_github_webhook_payload(
    value: &Value,
    event: &str,
) -> Result<Vec<ExternalChange>, String> {
    if event != "issues" {
        return Ok(Vec::new());
    }
    let action = value.get("action").and_then(Value::as_str).unwrap_or("");
    let issue = match value.get("issue") {
        Some(node) if !node.is_null() => node,
        _ => return Err("GitHub issues webhook missing issue".to_string()),
    };
    if is_pull_request(issue) {
        return Ok(Vec::new());
    }
    let mut change = parse_github_issue(issue)?;
    if action == "deleted" {
        change.deleted = true;
    }
    Ok(vec![change])
}

/// Pull the JSON payload off one outbox row, defaulting to an empty
/// object so callers don't have to repeat the unwrap dance.
pub fn payload_value(entry: &OutboxEntry) -> Result<Value, String> {
    if entry.payload_json.is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    serde_json::from_str(&entry.payload_json)
        .map_err(|err| format!("outbox payload not valid JSON: {}", err))
}

/// Discriminator used by `GitHubAdapter::push` to pick the
/// right HTTP request shape.
pub fn op_supports_push(op: OutboxOp) -> Result<(), String> {
    match op {
        OutboxOp::Create | OutboxOp::Update | OutboxOp::Delete => Ok(()),
        OutboxOp::MergeExternal => {
            Err("merge_external rows are pull-side artifacts and must not be pushed".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue_node() -> Value {
        json!({
            "number": 42,
            "title": "Implement GitHub adapter",
            "body": "**body**",
            "state": "open",
            "updated_at": "2026-04-29T01:23:45Z",
            "assignees": [
                { "login": "alice" },
                { "login": "bob" },
            ],
            "labels": [
                { "id": 1, "name": "backend" },
                { "id": 2, "name": "p1" },
            ],
            "milestone": { "title": "v1.0", "number": 7 },
        })
    }

    #[test]
    fn parse_full_issue_round_trip() {
        let change = parse_github_issue(&issue_node()).unwrap();
        assert_eq!(change.external_id, "42");
        assert_eq!(change.entity_type, EntityType::WorkItem);
        assert!(!change.deleted);
        assert_eq!(change.fields["title"], "Implement GitHub adapter");
        assert_eq!(change.fields["status"], "open");
        assert_eq!(change.fields["assignee"], "alice");
        assert_eq!(change.fields["labels"], json!(["backend", "p1"]));
        assert_eq!(change.fields["milestone"], "v1.0");
    }

    #[test]
    fn parse_skips_pull_requests_via_helper() {
        let node = json!({
            "number": 1,
            "title": "PR",
            "updated_at": "2026-04-29T01:23:45Z",
            "pull_request": { "url": "..." },
        });
        assert!(is_pull_request(&node));
    }

    #[test]
    fn parse_real_issue_is_not_pull_request() {
        assert!(!is_pull_request(&issue_node()));
    }

    #[test]
    fn parse_missing_number_errors() {
        let mut node = issue_node();
        node.as_object_mut().unwrap().remove("number");
        assert!(parse_github_issue(&node).is_err());
    }

    #[test]
    fn parse_handles_no_assignees() {
        let mut node = issue_node();
        node["assignees"] = json!([]);
        let change = parse_github_issue(&node).unwrap();
        assert!(change.fields.get("assignee").is_none());
    }

    #[test]
    fn build_update_body_filters_invalid_state() {
        let body = build_issue_update_body(&json!({
            "title": "T",
            "status": "in_progress",
        }));
        let obj = body.as_object().unwrap();
        assert_eq!(obj["title"], "T");
        assert!(!obj.contains_key("state"));
    }

    #[test]
    fn build_update_body_passes_valid_state() {
        let body = build_issue_update_body(&json!({ "status": "closed" }));
        assert_eq!(body["state"], "closed");
    }

    #[test]
    fn build_update_body_drops_null_body() {
        let body = build_issue_update_body(&json!({ "title": "T", "body": null }));
        let obj = body.as_object().unwrap();
        assert!(!obj.contains_key("body"));
    }

    #[test]
    fn build_update_body_emits_label_names() {
        let body = build_issue_update_body(&json!({ "labels": ["a", "b"] }));
        assert_eq!(body["labels"], json!(["a", "b"]));
    }

    #[test]
    fn build_create_body_requires_title() {
        assert!(build_issue_create_body(&json!({ "body": "B" })).is_err());
    }

    #[test]
    fn build_create_body_drops_state() {
        let body = build_issue_create_body(&json!({
            "title": "T",
            "status": "closed",
        }))
        .unwrap();
        let obj = body.as_object().unwrap();
        assert_eq!(obj["title"], "T");
        assert!(!obj.contains_key("state"));
    }

    #[test]
    fn build_close_body_uses_not_planned() {
        let body = build_issue_close_body();
        assert_eq!(body["state"], "closed");
        assert_eq!(body["state_reason"], "not_planned");
    }

    #[test]
    fn config_parse_requires_both_fields() {
        assert!(GitHubConfig::parse(None).is_err());
        assert!(GitHubConfig::parse(Some("{}")).is_err());
        assert!(GitHubConfig::parse(Some("{ \"owner\": \"\" }")).is_err());
        assert!(GitHubConfig::parse(Some("not json")).is_err());

        let parsed = GitHubConfig::parse(Some("{\"owner\":\"o\",\"repo\":\"r\"}")).unwrap();
        assert_eq!(parsed.owner, "o");
        assert_eq!(parsed.repo, "r");
    }

    #[test]
    fn webhook_opened_event_returns_change() {
        let envelope = json!({
            "action": "opened",
            "issue": issue_node(),
            "repository": { "full_name": "o/r" },
        });
        let changes = parse_github_webhook_payload(&envelope, "issues").unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].external_id, "42");
        assert!(!changes[0].deleted);
    }

    #[test]
    fn webhook_deleted_event_marks_deleted() {
        let envelope = json!({
            "action": "deleted",
            "issue": issue_node(),
        });
        let changes = parse_github_webhook_payload(&envelope, "issues").unwrap();
        assert!(changes[0].deleted);
    }

    #[test]
    fn webhook_skips_pull_requests() {
        let envelope = json!({
            "action": "opened",
            "issue": {
                "number": 1,
                "title": "PR",
                "updated_at": "2026-04-29T01:00:00Z",
                "pull_request": { "url": "..." },
            }
        });
        let changes = parse_github_webhook_payload(&envelope, "issues").unwrap();
        assert!(changes.is_empty());
    }

    #[test]
    fn webhook_non_issues_event_is_dropped() {
        let envelope = json!({ "action": "created", "comment": { "id": 1 } });
        let changes = parse_github_webhook_payload(&envelope, "issue_comment").unwrap();
        assert!(changes.is_empty());
    }

    #[test]
    fn webhook_missing_issue_errors() {
        let envelope = json!({ "action": "opened" });
        assert!(parse_github_webhook_payload(&envelope, "issues").is_err());
    }

    #[test]
    fn op_supports_push_rejects_merge_external() {
        assert!(op_supports_push(OutboxOp::Create).is_ok());
        assert!(op_supports_push(OutboxOp::Update).is_ok());
        assert!(op_supports_push(OutboxOp::Delete).is_ok());
        assert!(op_supports_push(OutboxOp::MergeExternal).is_err());
    }
}
