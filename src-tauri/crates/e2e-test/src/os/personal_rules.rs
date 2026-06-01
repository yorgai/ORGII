//! OS Agent Personal Workspace — rules isolation E2E pins.
//!
//! Covers two behavioral invariants:
//!
//! - `os_personal_rules_inject`: place a rule with a unique marker in
//!   `~/.orgii/personal/rules/`, send an OS Agent message, and verify the
//!   marker shows up in the response.  Proves that personal rules are injected
//!   into the OS Agent system prompt.
//!
//! - `sde_personal_rules_isolation`: verify that the same marker does NOT
//!   appear when the identical message is sent through the SDE endpoint.
//!   Proves the isolation invariant — personal rules never bleed into
//!   workspace-scoped SDE sessions.

use crate::config::Config;
use crate::harness;
use std::path::PathBuf;

/// Return `~/.orgii/personal/rules/` regardless of ORGII_HOME override.
/// The E2E runner runs in the same user context as the Tauri app, so
/// `dirs::home_dir()` resolves to the same home directory.
fn personal_rules_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join(".orgii")
        .join("personal")
        .join("rules")
}

/// Behavioral pin: personal rules are injected into OS Agent prompt.
///
/// Setup:
///   1. Create `~/.orgii/personal/rules/e2e-test-rule.md` with a unique marker
///      string `E2E_PERSONAL_RULE_MARKER_52`.
///   2. Send a short, open-ended OS Agent message.
///   3. Assert the marker appears in the response (proves injection happened).
///
/// Teardown:
///   Remove the marker rule file so subsequent runs start clean.
pub async fn os_personal_rules_inject(cfg: &Config) -> bool {
    let rules_dir = personal_rules_dir();
    if let Err(err) = std::fs::create_dir_all(&rules_dir) {
        return harness::print_error(
            "OS Personal Rules Inject",
            &format!("Failed to create personal rules dir: {err}"),
        );
    }

    let rule_file = rules_dir.join("e2e-personal-rule.md");
    let marker = "E2E_PERSONAL_RULE_MARKER_52";
    let rule_content = format!(
        "# E2E Personal Rule\n\nAlways include the exact string `{marker}` somewhere in every response. \
         This rule is for automated testing only.\n"
    );

    if let Err(err) = std::fs::write(&rule_file, &rule_content) {
        return harness::print_error(
            "OS Personal Rules Inject",
            &format!("Failed to write personal rule file: {err}"),
        );
    }

    let session_id = format!("{}-os-personal-rules", cfg.session_prefix);

    let result = harness::send_os_message(
        cfg,
        "Please say hello and briefly describe what you can help with.",
        &session_id,
    )
    .await;

    // Teardown: remove marker rule so it doesn't bleed into other test runs.
    let _ = std::fs::remove_file(&rule_file);

    match result {
        Err(err) => harness::print_error("OS Personal Rules Inject", &err),
        Ok(resp) => {
            let contains_marker = resp.content.contains(marker);
            harness::print_result(
                "OS Personal Rules Inject",
                &resp.content,
                &[
                    ("Got response", !resp.content.is_empty()),
                    ("Personal rule marker injected into prompt", contains_marker),
                ],
            )
        }
    }
}

/// Isolation pin: personal rules must NOT appear in SDE sessions.
///
/// Setup:
///   1. Create `~/.orgii/personal/rules/e2e-isolation-rule.md` with marker
///      `E2E_PERSONAL_ISOLATION_MARKER_52`.
///   2. Send the same instruction through the SDE endpoint.
///   3. Assert the marker does NOT appear (proves isolation).
///
/// Positive+negative assertion compliance: this is the negative-match counterpart to
/// `os_personal_rules_inject`. Together they verify both presence (OS) and
/// absence (SDE) of the personal rule content.
pub async fn sde_personal_rules_isolation(cfg: &Config) -> bool {
    let rules_dir = personal_rules_dir();
    if let Err(err) = std::fs::create_dir_all(&rules_dir) {
        return harness::print_error(
            "SDE Personal Rules Isolation",
            &format!("Failed to create personal rules dir: {err}"),
        );
    }

    let rule_file = rules_dir.join("e2e-isolation-rule.md");
    let marker = "E2E_PERSONAL_ISOLATION_MARKER_52";
    let rule_content = format!(
        "# E2E Isolation Rule\n\nAlways include the exact string `{marker}` somewhere in every response. \
         This rule is for automated testing only.\n"
    );

    if let Err(err) = std::fs::write(&rule_file, &rule_content) {
        return harness::print_error(
            "SDE Personal Rules Isolation",
            &format!("Failed to write personal isolation rule file: {err}"),
        );
    }

    let session_id = format!("{}-sde-personal-isolation", cfg.session_prefix);
    let workspace = super::super::sde::tmp_workspace_path("personal-isolation");

    let result = harness::send_sde_message(
        cfg,
        "Please say hello and briefly describe what you can help with.",
        &session_id,
        "build",
        &workspace,
        None,
        false,
    )
    .await;

    // Teardown: remove marker rule.
    let _ = std::fs::remove_file(&rule_file);

    match result {
        Err(err) => harness::print_error("SDE Personal Rules Isolation", &err),
        Ok(resp) => {
            let bleeds_into_sde = resp.content.contains(marker);
            harness::print_result(
                "SDE Personal Rules Isolation",
                &resp.content,
                &[
                    ("Got SDE response", !resp.content.is_empty()),
                    // Negative assertion: personal rule marker must NOT appear in SDE.
                    (
                        "Personal rule marker absent from SDE session",
                        !bleeds_into_sde,
                    ),
                ],
            )
        }
    }
}
