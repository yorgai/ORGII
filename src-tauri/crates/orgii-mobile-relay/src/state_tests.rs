use super::*;
use crate::hub::UserHubRegistry;
use crate::storage::MemoryStorage;
use std::sync::Arc;

#[tokio::test]
async fn app_state_clones_share_underlying_arcs() {
    let storage: Arc<dyn crate::storage::Storage> = Arc::new(MemoryStorage::new());
    let registry = Arc::new(UserHubRegistry::new());
    let state = AppState::new(storage, registry.clone());
    let cloned = state.clone();
    assert!(
        Arc::ptr_eq(&state.hub_registry, &cloned.hub_registry),
        "Clone must share the same registry Arc",
    );
}
