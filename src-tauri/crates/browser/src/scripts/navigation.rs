//! SPA Navigation Detection Script
//!
//! Detects client-side navigation in single-page applications by intercepting
//! history.pushState, history.replaceState, popstate, and hashchange events.

/// JavaScript for detecting SPA navigation (pushState/replaceState)
/// Works alongside on_navigation to detect 100% of URL changes
pub const SPA_NAVIGATION_SCRIPT: &str = r#"
(function() {
    // Avoid double-injection
    if (window.__ORGII_NAV_INJECTED__) return;
    window.__ORGII_NAV_INJECTED__ = true;

    const emit = (url, navType) => {
        if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
            window.__TAURI__.event.emit('browser-url-changed', { url, navType });
        }
    };

    // Detect pushState and replaceState (SPA navigation)
    ['pushState', 'replaceState'].forEach(fn => {
        const original = history[fn];
        history[fn] = function() {
            const result = original.apply(this, arguments);
            emit(location.href, fn);
            return result;
        };
    });

    // Detect back/forward navigation
    window.addEventListener('popstate', () => {
        emit(location.href, 'popstate');
    });

    // Detect hash changes
    window.addEventListener('hashchange', () => {
        emit(location.href, 'hashchange');
    });

    // Emit initial URL
    emit(location.href, 'initial');
})();
"#;
