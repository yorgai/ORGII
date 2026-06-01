use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelReason {
    UserStop,
    ForceSend,
    OrgPause,
    ProgrammaticShutdown,
    SessionEviction,
    ModeSwitchAbort,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TurnBoundaryEffect {
    pub rollback_if_no_output: bool,
    pub keep_pre_turn_cancel_when_idle: bool,
    pub clear_pending_approvals: bool,
    pub persist_cancel_marker: bool,
    pub allow_crash_repair_on_next_turn: bool,
}

impl CancelReason {
    pub fn boundary_effect(self) -> TurnBoundaryEffect {
        match self {
            Self::UserStop => TurnBoundaryEffect {
                rollback_if_no_output: true,
                keep_pre_turn_cancel_when_idle: true,
                clear_pending_approvals: true,
                persist_cancel_marker: true,
                allow_crash_repair_on_next_turn: false,
            },
            Self::ForceSend => TurnBoundaryEffect {
                rollback_if_no_output: false,
                keep_pre_turn_cancel_when_idle: false,
                clear_pending_approvals: false,
                persist_cancel_marker: false,
                allow_crash_repair_on_next_turn: false,
            },
            Self::OrgPause => TurnBoundaryEffect {
                rollback_if_no_output: false,
                keep_pre_turn_cancel_when_idle: true,
                clear_pending_approvals: false,
                persist_cancel_marker: false,
                allow_crash_repair_on_next_turn: false,
            },
            Self::ProgrammaticShutdown | Self::SessionEviction | Self::ModeSwitchAbort => {
                TurnBoundaryEffect {
                    rollback_if_no_output: false,
                    keep_pre_turn_cancel_when_idle: false,
                    clear_pending_approvals: true,
                    persist_cancel_marker: false,
                    allow_crash_repair_on_next_turn: false,
                }
            }
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::UserStop => "user_stop",
            Self::ForceSend => "force_send",
            Self::OrgPause => "org_pause",
            Self::ProgrammaticShutdown => "programmatic_shutdown",
            Self::SessionEviction => "session_eviction",
            Self::ModeSwitchAbort => "mode_switch_abort",
        }
    }
}

impl Default for CancelReason {
    fn default() -> Self {
        Self::UserStop
    }
}
