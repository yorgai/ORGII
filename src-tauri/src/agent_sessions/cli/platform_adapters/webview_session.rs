pub(crate) const COMMON_OAUTH_SESSION_DOMAINS: &[&str] = &[
    "accounts.google.com",
    "github.com",
    "login.microsoftonline.com",
    "microsoftonline.com",
    "workos.com",
    "auth0.com",
];

#[cfg(target_os = "macos")]
pub(crate) fn clear_oauth_browser_session_native(app: &tauri::AppHandle, domains: &[&str]) {
    let domains = domains
        .iter()
        .map(|domain| domain.to_string())
        .collect::<Vec<_>>();
    let dispatch_result = app.run_on_main_thread(move || {
        clear_shared_http_cookies(&domains);
    });

    if let Err(err) = dispatch_result {
        tracing::warn!(error = %err, "failed to dispatch OAuth browser session clearing to main thread");
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn clear_oauth_browser_session_native(_app: &tauri::AppHandle, _domains: &[&str]) {}

#[cfg(target_os = "macos")]
fn clear_shared_http_cookies(domains: &[String]) {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    unsafe {
        let Some(cookie_storage_class) = AnyClass::get(c"NSHTTPCookieStorage") else {
            return;
        };
        let storage: *mut AnyObject = msg_send![cookie_storage_class, sharedHTTPCookieStorage];
        if storage.is_null() {
            return;
        }

        let cookies: *mut AnyObject = msg_send![storage, cookies];
        if cookies.is_null() {
            return;
        }

        let count: usize = msg_send![cookies, count];
        for index in 0..count {
            let cookie: *mut AnyObject = msg_send![cookies, objectAtIndex: index];
            if cookie.is_null() {
                continue;
            }

            let domain: *mut AnyObject = msg_send![cookie, domain];
            if domain.is_null() {
                continue;
            }

            if let Some(domain_string) = browser::cookies::nsstring_to_string(domain) {
                if domain_matches_owned(&domain_string, domains) {
                    let _: () = msg_send![storage, deleteCookie: cookie];
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn domain_matches_owned(cookie_domain: &str, domains: &[String]) -> bool {
    domains.iter().any(|domain| {
        let normalized_cookie_domain = cookie_domain.trim_start_matches('.');
        normalized_cookie_domain == domain
            || normalized_cookie_domain.ends_with(&format!(".{domain}"))
    })
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::domain_matches_owned;

    #[cfg(target_os = "macos")]
    #[test]
    fn domain_matches_exact_and_subdomains() {
        assert!(domain_matches_owned(
            "claude.ai",
            &["claude.ai".to_string()]
        ));
        assert!(domain_matches_owned(
            ".accounts.google.com",
            &["accounts.google.com".to_string()]
        ));
        assert!(domain_matches_owned(
            "login.microsoftonline.com",
            &["microsoftonline.com".to_string()]
        ));
        assert!(!domain_matches_owned(
            "notclaude.ai.example.com",
            &["claude.ai".to_string()]
        ));
    }
}
