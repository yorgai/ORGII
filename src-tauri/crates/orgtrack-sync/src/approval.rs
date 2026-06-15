use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalState {
    #[default]
    ApprovalPending,
    Validated,
    Included,
    Rejected,
    Superseded,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustLevel {
    #[default]
    LocalDraft,
    ContributorClaim,
    MaintainerReviewed,
    TrustedAutomation,
    Official,
}
