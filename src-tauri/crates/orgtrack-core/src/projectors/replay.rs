use serde::{Deserialize, Serialize};

use crate::canonical::{ActivityRecord, SessionRecord};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayProjection {
    pub session: SessionRecord,
    pub activities: Vec<ActivityRecord>,
}

pub fn project_replay(
    session: SessionRecord,
    mut activities: Vec<ActivityRecord>,
) -> ReplayProjection {
    activities.sort_by(|left, right| left.timestamp.cmp(&right.timestamp));
    ReplayProjection {
        session,
        activities,
    }
}
