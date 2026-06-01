//! In-memory `EchoAdapter` — accepts every push, observes no remote
//! changes, exists purely so the worker loop can be exercised end-to-end
//! in tests without booting a real network adapter.
//!
//! Production use: never. Tests only. The descriptor is hidden behind
//! `requires_auth = false` so the UI may show it for manual smoke
//! testing, but it carries no real-world value.
//!
//! ## Debug-only failure injection (E2E sync scenarios)
//!
//! Under `#[cfg(debug_assertions)]` the adapter exposes a per-slug
//! flag map (`ECHO_DEBUG_FLAGS`) that lets the e2e harness force the
//! next push (or every push) to fail. Production builds never compile
//! the flag check into [`SyncAdapter::push`] — release semantics are
//! "every push succeeds, full stop". The flags are toggled via the
//! `/agent/test/sync/echo-flag` debug endpoint.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::sync::adapter::{
    AdapterDescriptor, EntityField, ExternalChange, FieldMap, FieldMapping, PullOutcome,
    SyncAdapter, SyncContext, SyncOutcome, WebhookHeaders,
};
use crate::sync::types::{EntityType, OutboxEntry, SyncError, SyncResult};

/// Header carrying the test webhook signature. Lower-cased to match
/// the listener's folded header form.
pub const ECHO_SIGNATURE_HEADER: &str = "x-echo-signature";
/// Prefix on `X-Echo-Signature`. Same convention GitHub uses for
/// `sha256=…`; lets us evolve the algorithm without breaking the
/// header shape.
const ECHO_SIGNATURE_PREFIX: &str = "sha256=";

/// Minimal adapter that succeeds every push and pulls nothing.
#[derive(Debug, Default, Clone, Copy)]
pub struct EchoAdapter;

static ECHO_FIELD_MAP: FieldMap = FieldMap {
    mappings: &[
        FieldMapping {
            local: EntityField::Title,
            remote: "title",
            writable: true,
        },
        FieldMapping {
            local: EntityField::Status,
            remote: "status",
            writable: true,
        },
    ],
};

#[async_trait]
impl SyncAdapter for EchoAdapter {
    fn name(&self) -> &'static str {
        "echo"
    }

    async fn push(&self, entry: &OutboxEntry, _ctx: &SyncContext) -> SyncResult {
        #[cfg(debug_assertions)]
        if let Some(err) = debug_flags::consume_failure_for(&entry.project_slug) {
            return Err(err);
        }
        Ok(SyncOutcome {
            external_id: Some(format!("echo:{}/{}", entry.project_slug, entry.entity_id)),
            remote_updated_at: Some(Utc::now()),
        })
    }

    async fn pull(
        &self,
        _project_slug: &str,
        _ctx: &SyncContext,
        _since: Option<DateTime<Utc>>,
    ) -> Result<PullOutcome, SyncError> {
        Ok(PullOutcome::default())
    }

    fn entity_field_map(&self) -> &'static FieldMap {
        &ECHO_FIELD_MAP
    }

    fn descriptor(&self) -> AdapterDescriptor {
        AdapterDescriptor {
            id: self.name().to_string(),
            label: "Echo (test only)".to_string(),
            requires_auth: false,
            auth_methods: Vec::new(),
            supports_webhook: self.supports_webhook(),
            supports_import: self.supports_import(),
        }
    }

    fn supports_webhook(&self) -> bool {
        true
    }

    fn supports_import(&self) -> bool {
        true
    }

    /// Test-only bulk import: walks a synthetic 2-page history of
    /// 2 work-item changes per page so the bulk-import e2e scenarios
    /// have a deterministic shape to assert on. The page cursor is
    /// the literal string `"page1"` / `"page2"`; absent cursor
    /// returns page 1.
    ///
    /// Permanent adapters drive their cursor scheme (Linear's
    /// GraphQL `endCursor`, GitHub's `Link: …rel="next"` URL); the
    /// echo shape is intentionally simple — exhaust two pages then
    /// signal `next_page_cursor = None`.
    async fn pull_all(
        &self,
        project_slug: &str,
        _ctx: &SyncContext,
        page_cursor: Option<&str>,
    ) -> Result<super::super::adapter::ImportPage, SyncError> {
        use super::super::adapter::{ExternalChange, ImportPage};
        use super::super::types::EntityType;
        use chrono::{TimeZone, Utc};

        let make_change = |seq: u64, page: &str| ExternalChange {
            entity_type: EntityType::WorkItem,
            external_id: format!("echo-import-{project_slug}-{page}-{seq}"),
            local_entity_id: None,
            fields: serde_json::json!({
                "title": format!("imported #{seq} from {page}"),
                "body": "",
                "status": "backlog",
            }),
            remote_updated_at: Utc
                .timestamp_millis_opt(1_700_000_000_000 + seq as i64 * 1000)
                .unwrap(),
            deleted: false,
        };

        match page_cursor {
            None => Ok(ImportPage {
                changes: vec![make_change(1, "page1"), make_change(2, "page1")],
                next_page_cursor: Some("page2".to_string()),
                total_hint: Some(4),
            }),
            Some("page2") => Ok(ImportPage {
                changes: vec![make_change(3, "page2"), make_change(4, "page2")],
                next_page_cursor: None,
                total_hint: Some(4),
            }),
            Some(other) => Err(SyncError::Permanent(format!(
                "echo adapter does not recognize page cursor: {other}"
            ))),
        }
    }

    /// Verify the test signature scheme: `X-Echo-Signature: sha256=<hex>`
    /// where `<hex>` is the lower-case HMAC-SHA256 of the raw body
    /// keyed on the hex-decoded secret.
    ///
    /// Used by the e2e scenarios as a stand-in for real provider
    /// HMAC schemes (Linear / GitHub) so the listener path is
    /// exercisable without a tunnel.
    fn verify_webhook(
        &self,
        body: &[u8],
        headers: &WebhookHeaders,
        secret_hex: &str,
    ) -> Result<(), SyncError> {
        let header = headers
            .get(ECHO_SIGNATURE_HEADER)
            .ok_or_else(|| SyncError::AuthFailed("X-Echo-Signature header missing".to_string()))?;
        let signature_hex = header.strip_prefix(ECHO_SIGNATURE_PREFIX).ok_or_else(|| {
            SyncError::AuthFailed(format!(
                "X-Echo-Signature must start with '{}'",
                ECHO_SIGNATURE_PREFIX
            ))
        })?;
        let received = hex::decode(signature_hex).map_err(|err| {
            SyncError::AuthFailed(format!("X-Echo-Signature is not valid hex: {}", err))
        })?;

        let key = hex::decode(secret_hex).map_err(|err| {
            SyncError::Permanent(format!("stored echo secret is not valid hex: {}", err))
        })?;
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&key)
            .map_err(|err| SyncError::Permanent(format!("HMAC-SHA256 key invalid: {}", err)))?;
        mac.update(body);
        let expected = mac.finalize().into_bytes();

        // `subtle`'s constant-time compare prevents the verify path
        // from leaking signature length or prefix-match info to a
        // remote attacker via timing.
        if expected.ct_eq(&received).into() {
            Ok(())
        } else {
            Err(SyncError::AuthFailed(
                "X-Echo-Signature did not match expected HMAC".to_string(),
            ))
        }
    }

    /// Parse the trivial test webhook body: a JSON envelope of
    /// `{ "changes": [ExternalChange, ...] }`. The shape mirrors the
    /// adapter's own pull outcome so e2e scenarios can construct
    /// inbound deliveries without bespoke serialization.
    async fn handle_webhook(
        &self,
        body: &[u8],
        _headers: &WebhookHeaders,
        _ctx: &SyncContext,
    ) -> Result<Vec<ExternalChange>, SyncError> {
        let envelope: EchoWebhookBody = serde_json::from_slice(body).map_err(|err| {
            SyncError::Permanent(format!("echo webhook body is not valid JSON: {}", err))
        })?;
        // The envelope's `changes` carry serde-default `entity_type`
        // when the test omits it; we backfill `WorkItem` so simple
        // payloads (e.g. `{ "changes": [{...}] }` with just title) stay
        // ergonomic in scenario fixtures.
        let mut out = Vec::with_capacity(envelope.changes.len());
        for raw in envelope.changes {
            out.push(ExternalChange {
                entity_type: raw.entity_type.unwrap_or(EntityType::WorkItem),
                external_id: raw.external_id,
                local_entity_id: raw.local_entity_id,
                fields: raw.fields,
                remote_updated_at: raw.remote_updated_at.unwrap_or_else(Utc::now),
                deleted: raw.deleted,
            });
        }
        Ok(out)
    }
}

/// Outer envelope used by the e2e scenarios to ship a list of
/// changes through the listener. Kept private to the echo adapter —
/// real adapters define their own provider-specific shapes.
#[derive(Debug, serde::Deserialize)]
struct EchoWebhookBody {
    #[serde(default)]
    changes: Vec<EchoWebhookChange>,
}

/// Same shape as [`ExternalChange`] but every field is optional so
/// scenario fixtures can omit defaults. The `handle_webhook` impl
/// fills in sensible values (current time, `WorkItem` entity type)
/// before handing the canonical change to the worker.
#[derive(Debug, serde::Deserialize)]
struct EchoWebhookChange {
    #[serde(default)]
    entity_type: Option<EntityType>,
    external_id: String,
    #[serde(default)]
    local_entity_id: Option<String>,
    #[serde(default = "empty_object")]
    fields: serde_json::Value,
    #[serde(default)]
    remote_updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    deleted: bool,
}

fn empty_object() -> serde_json::Value {
    serde_json::Value::Object(serde_json::Map::new())
}

#[cfg(debug_assertions)]
impl EchoAdapter {
    /// Arm a one-shot push failure for the given project. The next
    /// push for this slug returns `SyncError::Transient(...)`; the
    /// flag self-clears after one consumed call so subsequent pumps
    /// see the normal happy-path adapter again.
    pub fn set_force_next_failure(slug: &str, force: bool) {
        debug_flags::set_force_next(slug, force);
    }

    /// Arm a sticky push failure for the given project. Every push
    /// for this slug returns `SyncError::Transient(...)` until the
    /// flag is cleared explicitly (call with `false`).
    pub fn set_force_persistent_failure(slug: &str, force: bool) {
        debug_flags::set_force_persistent(slug, force);
    }
}

#[cfg(debug_assertions)]
mod debug_flags {
    //! Process-wide flag registry, keyed by project slug. The Echo
    //! adapter is a unit struct stored as `Arc<dyn SyncAdapter>` in
    //! the global registry, so it cannot carry per-instance mutable
    //! state. We park the flags in a `OnceLock<Mutex<HashMap>>` keyed
    //! by slug — push consults this map by `entry.project_slug` and
    //! the debug endpoint mutates it directly via the static helpers
    //! exposed on `EchoAdapter` (no instance handle required).

    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    use crate::sync::types::SyncError;

    #[derive(Default, Clone, Copy)]
    struct EchoDebugFlags {
        force_next_failure: bool,
        force_persistent_failure: bool,
    }

    static ECHO_DEBUG_FLAGS: OnceLock<Mutex<HashMap<String, EchoDebugFlags>>> = OnceLock::new();

    fn map() -> &'static Mutex<HashMap<String, EchoDebugFlags>> {
        ECHO_DEBUG_FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub(super) fn set_force_next(slug: &str, force: bool) {
        let mut guard = map().lock().expect("echo debug flags poisoned");
        let entry = guard.entry(slug.to_string()).or_default();
        entry.force_next_failure = force;
    }

    pub(super) fn set_force_persistent(slug: &str, force: bool) {
        let mut guard = map().lock().expect("echo debug flags poisoned");
        let entry = guard.entry(slug.to_string()).or_default();
        entry.force_persistent_failure = force;
    }

    /// Consume the failure flag(s) for `slug`. Returns the synthetic
    /// `SyncError` to surface, or `None` when no failure is armed.
    /// The one-shot flag self-clears here so the next call sees the
    /// happy path; the persistent flag is left untouched.
    pub(super) fn consume_failure_for(slug: &str) -> Option<SyncError> {
        let mut guard = map().lock().expect("echo debug flags poisoned");
        let flags = guard.get_mut(slug)?;
        if flags.force_persistent_failure {
            return Some(SyncError::Transient(
                "echo debug: persistent failure armed".to_string(),
            ));
        }
        if flags.force_next_failure {
            flags.force_next_failure = false;
            return Some(SyncError::Transient(
                "echo debug: one-shot failure armed".to_string(),
            ));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::types::{EntityType, OutboxOp, OutboxStatus};

    fn ctx() -> SyncContext {
        SyncContext {
            adapter_id: "echo".to_string(),
            auth_token: None,
            project_slug: "alpha".to_string(),
            cursor_blob: None,
            config_json: None,
        }
    }

    fn entry() -> OutboxEntry {
        OutboxEntry {
            id: Some(1),
            project_slug: "alpha".to_string(),
            entity_type: EntityType::WorkItem,
            entity_id: "WI-1".to_string(),
            op: OutboxOp::Create,
            field_path: None,
            payload_json: "{}".to_string(),
            created_at: 0,
            retry_count: 0,
            last_attempted_at: None,
            last_error: None,
            status: OutboxStatus::InFlight,
        }
    }

    #[tokio::test]
    async fn push_succeeds_with_external_id() {
        let outcome = EchoAdapter.push(&entry(), &ctx()).await.unwrap();
        assert_eq!(outcome.external_id.as_deref(), Some("echo:alpha/WI-1"));
        assert!(outcome.remote_updated_at.is_some());
    }

    #[tokio::test]
    async fn pull_is_empty() {
        let outcome = EchoAdapter.pull("alpha", &ctx(), None).await.unwrap();
        assert!(outcome.changes.is_empty());
        assert!(outcome.next_cursor.is_none());
    }

    #[test]
    fn descriptor_marks_requires_auth_false() {
        let d = EchoAdapter.descriptor();
        assert_eq!(d.id, "echo");
        assert!(!d.requires_auth);
        assert!(d.auth_methods.is_empty());
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn force_next_failure_is_one_shot() {
        let slug = "force-next-failure-test";
        let mut e = entry();
        e.project_slug = slug.to_string();
        let mut c = ctx();
        c.project_slug = slug.to_string();

        EchoAdapter::set_force_next_failure(slug, true);
        let err = EchoAdapter
            .push(&e, &c)
            .await
            .expect_err("first push must fail");
        assert!(matches!(err, SyncError::Transient(_)));

        // Second call: flag self-cleared, normal happy path.
        let outcome = EchoAdapter
            .push(&e, &c)
            .await
            .expect("second push succeeds after self-clear");
        assert!(outcome.external_id.is_some());

        // Cleanup so other tests aren't affected.
        EchoAdapter::set_force_next_failure(slug, false);
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn force_persistent_failure_is_sticky() {
        let slug = "force-persistent-failure-test";
        let mut e = entry();
        e.project_slug = slug.to_string();
        let mut c = ctx();
        c.project_slug = slug.to_string();

        EchoAdapter::set_force_persistent_failure(slug, true);
        for _ in 0..3 {
            let err = EchoAdapter
                .push(&e, &c)
                .await
                .expect_err("persistent failure must persist");
            assert!(matches!(err, SyncError::Transient(_)));
        }

        EchoAdapter::set_force_persistent_failure(slug, false);
        let outcome = EchoAdapter
            .push(&e, &c)
            .await
            .expect("clearing the flag restores happy path");
        assert!(outcome.external_id.is_some());
    }

    fn webhook_signature_for(body: &[u8], secret_hex: &str) -> String {
        let key = hex::decode(secret_hex).unwrap();
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&key).unwrap();
        mac.update(body);
        format!(
            "{}{}",
            ECHO_SIGNATURE_PREFIX,
            hex::encode(mac.finalize().into_bytes())
        )
    }

    #[test]
    fn supports_webhook_returns_true() {
        assert!(EchoAdapter.supports_webhook());
    }

    #[test]
    fn verify_webhook_accepts_correct_signature() {
        let body = br#"{"changes":[]}"#;
        let secret = "deadbeefcafef00d";
        let mut headers = WebhookHeaders::new();
        headers.insert(
            ECHO_SIGNATURE_HEADER.to_string(),
            webhook_signature_for(body, secret),
        );
        EchoAdapter
            .verify_webhook(body, &headers, secret)
            .expect("valid signature must verify");
    }

    #[test]
    fn verify_webhook_rejects_bad_signature() {
        let body = br#"{"changes":[]}"#;
        let secret = "deadbeefcafef00d";
        let mut headers = WebhookHeaders::new();
        headers.insert(
            ECHO_SIGNATURE_HEADER.to_string(),
            format!("{}{}", ECHO_SIGNATURE_PREFIX, "00".repeat(32)),
        );
        let err = EchoAdapter
            .verify_webhook(body, &headers, secret)
            .expect_err("bad signature must reject");
        assert!(matches!(err, SyncError::AuthFailed(_)));
    }

    #[test]
    fn verify_webhook_rejects_missing_header() {
        let secret = "deadbeefcafef00d";
        let headers = WebhookHeaders::new();
        let err = EchoAdapter
            .verify_webhook(b"{}", &headers, secret)
            .expect_err("missing header must reject");
        assert!(matches!(err, SyncError::AuthFailed(_)));
    }

    #[test]
    fn verify_webhook_rejects_wrong_prefix() {
        let body = br#"{}"#;
        let secret = "deadbeef";
        let mut headers = WebhookHeaders::new();
        headers.insert(ECHO_SIGNATURE_HEADER.to_string(), "md5=ffff".to_string());
        let err = EchoAdapter
            .verify_webhook(body, &headers, secret)
            .expect_err("wrong prefix must reject");
        assert!(matches!(err, SyncError::AuthFailed(_)));
    }

    #[tokio::test]
    async fn handle_webhook_parses_changes_envelope() {
        let body = br#"{
            "changes": [
                { "external_id": "ext-1", "fields": { "title": "from echo" } },
                { "external_id": "ext-2", "fields": { "status": "todo" }, "deleted": false }
            ]
        }"#;
        let headers = WebhookHeaders::new();
        let changes = EchoAdapter
            .handle_webhook(body, &headers, &ctx())
            .await
            .expect("parse ok");
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].external_id, "ext-1");
        assert_eq!(changes[0].entity_type, EntityType::WorkItem);
        assert_eq!(
            changes[0].fields.get("title").and_then(|v| v.as_str()),
            Some("from echo")
        );
        assert!(!changes[1].deleted);
    }

    #[tokio::test]
    async fn handle_webhook_rejects_malformed_body() {
        let err = EchoAdapter
            .handle_webhook(b"not json", &WebhookHeaders::new(), &ctx())
            .await
            .expect_err("non-JSON must reject");
        assert!(matches!(err, SyncError::Permanent(_)));
    }

    #[cfg(debug_assertions)]
    #[tokio::test]
    async fn force_flags_are_per_slug() {
        let armed = "echo-armed-slug";
        let unarmed = "echo-unarmed-slug";

        let mut e_armed = entry();
        e_armed.project_slug = armed.to_string();
        let mut c_armed = ctx();
        c_armed.project_slug = armed.to_string();

        let mut e_unarmed = entry();
        e_unarmed.project_slug = unarmed.to_string();
        let mut c_unarmed = ctx();
        c_unarmed.project_slug = unarmed.to_string();

        EchoAdapter::set_force_persistent_failure(armed, true);
        EchoAdapter
            .push(&e_armed, &c_armed)
            .await
            .expect_err("armed slug must fail");
        EchoAdapter
            .push(&e_unarmed, &c_unarmed)
            .await
            .expect("unarmed slug must succeed");

        EchoAdapter::set_force_persistent_failure(armed, false);
    }
}
