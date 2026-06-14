pub fn oauth_refresh_allowed() -> bool {
    std::env::var("ORGII_E2E").ok().as_deref() != Some("1")
        || std::env::var("E2E_PROVIDER_MODE").ok().as_deref() == Some("oauth-live")
}

pub fn ensure_oauth_refresh_allowed() -> Result<(), String> {
    if oauth_refresh_allowed() {
        return Ok(());
    }

    Err("OAuth refresh is disabled in E2E isolated runs. Use E2E_PROVIDER_MODE=oauth-live with E2E_OAUTH_TEST_HOME for dedicated single-owner OAuth tests.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn allows_refresh_outside_e2e() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::remove_var("ORGII_E2E");
        std::env::remove_var("E2E_PROVIDER_MODE");

        assert!(oauth_refresh_allowed());
        assert!(ensure_oauth_refresh_allowed().is_ok());
    }

    #[test]
    fn blocks_refresh_in_ordinary_e2e() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("ORGII_E2E", "1");
        std::env::set_var("E2E_PROVIDER_MODE", "api-key");

        assert!(!oauth_refresh_allowed());
        assert!(ensure_oauth_refresh_allowed()
            .unwrap_err()
            .contains("OAuth refresh is disabled in E2E isolated runs"));

        std::env::remove_var("ORGII_E2E");
        std::env::remove_var("E2E_PROVIDER_MODE");
    }

    #[test]
    fn allows_refresh_in_oauth_live_e2e() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("ORGII_E2E", "1");
        std::env::set_var("E2E_PROVIDER_MODE", "oauth-live");

        assert!(oauth_refresh_allowed());
        assert!(ensure_oauth_refresh_allowed().is_ok());

        std::env::remove_var("ORGII_E2E");
        std::env::remove_var("E2E_PROVIDER_MODE");
    }
}
