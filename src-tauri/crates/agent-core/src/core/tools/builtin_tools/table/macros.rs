//! `action_sub!` macro used by category files.
//!
//! Frontend no longer consumes per-engine / per-state layout slots, so
//! actions only carry the identity, the optional `AppSubtool` override, and
//! optional i18n label overrides. Chat-vs-simulator rendering differences
//! live inside the Block/Panel components themselves.

/// Action with a subtool override and optional label / chat_block overrides.
macro_rules! action_sub {
    ($name:expr, $summary:expr, $subtool:expr) => {
        $crate::core::tools::builtin_tools::types::ActionEntry {
            name: $name,
            summary: $summary,
            app_subtool: Some($subtool),
            chat_block: None,
            label_running: None,
            label_done: None,
            label_failed: None,
            status_labels: &[],
        }
    };
    ($name:expr, $summary:expr, $subtool:expr, labels: $lr:expr, $ld:expr, $lf:expr) => {
        $crate::core::tools::builtin_tools::types::ActionEntry {
            name: $name,
            summary: $summary,
            app_subtool: Some($subtool),
            chat_block: None,
            label_running: Some($lr),
            label_done: Some($ld),
            label_failed: Some($lf),
            status_labels: &[],
        }
    };
    (
        $name:expr,
        $summary:expr,
        $subtool:expr,
        chat: $cb:expr,
        labels: $lr:expr, $ld:expr, $lf:expr
    ) => {
        $crate::core::tools::builtin_tools::types::ActionEntry {
            name: $name,
            summary: $summary,
            app_subtool: Some($subtool),
            chat_block: Some($cb),
            label_running: Some($lr),
            label_done: Some($ld),
            label_failed: Some($lf),
            status_labels: &[],
        }
    };
}

pub(crate) use action_sub;
