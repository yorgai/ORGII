//! Agent Core Utilities
//!
//! Small utility modules (HTTP retry, shell process management, HTTP client builder).

pub mod http_retry;
pub mod pill_resolver;
pub mod safe_truncate;
pub mod shell_commands;
pub mod swr_cache;

/// Crate-wide canonical UTF-8 safe truncation helpers. See
/// [`safe_truncate`] for byte-bounded vs char-bounded variants.
pub use safe_truncate::{
    safe_truncate_chars, safe_truncate_chars_to_string, safe_truncate_utf8,
};

/// Re-export of the canonical `default_true` serde helper from `app_utils`.
///
/// New call sites should reference `app_utils::default_true` directly via
/// `#[serde(default = "app_utils::default_true")]`. This re-export exists so
/// existing `crate::utils::default_true` paths keep resolving.
pub use app_utils::default_true;

/// User-selectable HTTP version preference.
///
/// Mirrors the Cursor IDE "HTTP Version" setting. Some corporate proxies
/// and VPNs break HTTP/2 multiplexing; forcing HTTP/1.1 works around them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum HttpVersionPref {
    /// Let reqwest negotiate (prefers h2 via ALPN, falls back to HTTP/1.1).
    #[default]
    Auto,
    /// Force HTTP/1.1 only — useful behind broken proxies.
    Http1Only,
    /// Force HTTP/2 via prior knowledge (no ALPN negotiation).
    Http2Only,
}

impl HttpVersionPref {
    pub fn from_setting(value: &str) -> Self {
        match value {
            "http1" => Self::Http1Only,
            "http2" => Self::Http2Only,
            _ => Self::Auto,
        }
    }
}

/// Global HTTP version preference, set once at startup / settings change.
static HTTP_VERSION_PREF: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

const PREF_AUTO: u8 = 0;
const PREF_HTTP1: u8 = 1;
const PREF_HTTP2: u8 = 2;

pub fn set_global_http_version_pref(pref: HttpVersionPref) {
    let val = match pref {
        HttpVersionPref::Auto => PREF_AUTO,
        HttpVersionPref::Http1Only => PREF_HTTP1,
        HttpVersionPref::Http2Only => PREF_HTTP2,
    };
    HTTP_VERSION_PREF.store(val, std::sync::atomic::Ordering::Relaxed);
}

pub fn get_global_http_version_pref() -> HttpVersionPref {
    match HTTP_VERSION_PREF.load(std::sync::atomic::Ordering::Relaxed) {
        PREF_HTTP1 => HttpVersionPref::Http1Only,
        PREF_HTTP2 => HttpVersionPref::Http2Only,
        _ => HttpVersionPref::Auto,
    }
}

/// Read an error response body without silently hiding body-read failures.
pub async fn response_text_or_read_error(response: reqwest::Response) -> String {
    match response.text().await {
        Ok(body) => body,
        Err(err) => format!("<failed to read response body: {err}>"),
    }
}

fn base_http_client_builder(timeout: std::time::Duration) -> reqwest::ClientBuilder {
    let pref = get_global_http_version_pref();
    let builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(timeout)
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .pool_idle_timeout(std::time::Duration::from_secs(90))
        .http2_adaptive_window(true);

    match pref {
        HttpVersionPref::Http1Only => builder.http1_only(),
        HttpVersionPref::Http2Only => builder.http2_prior_knowledge(),
        HttpVersionPref::Auto => builder,
    }
}

/// Build an HTTP client with the given overall timeout and a fixed connect timeout.
///
/// Hardening beyond the basic reqwest defaults:
/// - **connect_timeout(10s)**: fast failure when a host is unreachable instead
///   of the macOS default (~75s).
/// - **tcp_keepalive(30s)**: prevents silent connection drops through
///   NAT/firewalls that reap idle connections after ~60s.
/// - **pool_idle_timeout(90s)**: recycles stale pooled connections before
///   they go dead on the server side.
/// - **http2_adaptive_window**: lets reqwest tune HTTP/2 flow-control
///   windows for streaming workloads (larger windows = fewer round-trips
///   waiting for window updates during long SSE streams).
/// - **HTTP version pref**: reads the global `HttpVersionPref` to let users
///   force HTTP/1.1 behind broken proxies.
///
/// Panics at startup if the TLS backend cannot be initialized (this would
/// indicate a broken system configuration that cannot be recovered from).
pub fn build_http_client(timeout: std::time::Duration) -> reqwest::Client {
    base_http_client_builder(timeout)
        .build()
        .expect("TLS backend initialization failed")
}

/// Same as [`build_http_client`] but routes outbound requests through the
/// supplied proxy URL when `proxy_url` is `Some` and non-empty. Accepts the
/// schemes reqwest's `Proxy::all` understands (`http://`, `https://`,
/// `socks5://`, `socks5h://`).
///
/// On a malformed proxy URL we log a warning and fall back to the
/// non-proxied client rather than failing the whole channel — proxy is a
/// connectivity convenience, not a correctness requirement, and the
/// surrounding Telegram poll loop already handles transient errors.
pub fn build_http_client_with_proxy(
    timeout: std::time::Duration,
    proxy_url: Option<&str>,
) -> reqwest::Client {
    let trimmed = proxy_url.map(str::trim).filter(|url| !url.is_empty());

    let mut builder = base_http_client_builder(timeout);
    if let Some(url) = trimmed {
        match reqwest::Proxy::all(url) {
            Ok(proxy) => {
                builder = builder.proxy(proxy);
            }
            Err(err) => {
                tracing::warn!(
                    proxy = url,
                    error = %err,
                    "invalid proxy URL; falling back to direct connection"
                );
            }
        }
    }

    builder.build().expect("TLS backend initialization failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::install_crypto_provider_for_tests;

    #[test]
    fn proxy_none_yields_direct_client() {
        install_crypto_provider_for_tests();
        let _ = build_http_client_with_proxy(std::time::Duration::from_secs(5), None);
    }

    #[test]
    fn proxy_empty_string_treated_as_direct() {
        install_crypto_provider_for_tests();
        let _ = build_http_client_with_proxy(std::time::Duration::from_secs(5), Some("   "));
    }

    #[test]
    fn proxy_valid_http_url_accepted() {
        install_crypto_provider_for_tests();
        let _ = build_http_client_with_proxy(
            std::time::Duration::from_secs(5),
            Some("http://127.0.0.1:8080"),
        );
    }

    #[test]
    fn proxy_invalid_url_falls_back_to_direct() {
        install_crypto_provider_for_tests();
        let _ = build_http_client_with_proxy(
            std::time::Duration::from_secs(5),
            Some("not a valid url"),
        );
    }
}
