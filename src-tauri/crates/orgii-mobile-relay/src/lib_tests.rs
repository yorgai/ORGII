use super::*;
use crate::hub::UserHubRegistry;
use crate::storage::MemoryStorage;
use std::sync::Arc;

#[tokio::test]
async fn public_surface_is_re_exported() {
    let _: AppConfig = AppConfig::default();
    let storage: Arc<dyn crate::storage::Storage> = Arc::new(MemoryStorage::new());
    let registry = Arc::new(UserHubRegistry::new());
    let _: AppState = AppState::new(storage, registry);
    let _err: RelayError = RelayError::Server("test".into());
}
