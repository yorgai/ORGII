//! Console and Network Capture Scripts
//!
//! Intercepts console.* methods, window errors, fetch, and XMLHttpRequest
//! to capture logs for display in the devtools panel.

/// JavaScript for capturing console logs and errors
///
/// Intercepts console.* methods and window errors, storing them
/// in a global array that can be retrieved via webview.eval().
///
/// NOTE: We store logs in `window.__ORGII_CONSOLE_LOGS__` instead of
/// using Tauri events because Tauri APIs are NOT available in inline
/// webviews loading external URLs.
pub const CONSOLE_CAPTURE_SCRIPT: &str = r#"
(function() {
    if (window.__ORGII_CONSOLE_CAPTURE__) return;
    window.__ORGII_CONSOLE_CAPTURE__ = true;

    const MAX_LOGS = 500;
    window.__ORGII_CONSOLE_LOGS__ = [];

    const addLog = (level, args, stack) => {
        const entry = {
            level,
            message: args.map(a => {
                try {
                    if (a instanceof Error) return a.name + ': ' + a.message;
                    if (typeof a === 'object' && a !== null) {
                        return JSON.stringify(a);
                    }
                    return String(a);
                } catch (e) { return String(a); }
            }).join(' '),
            timestamp: Date.now(),
            url: location.href,
            stack: stack || null
        };

        window.__ORGII_CONSOLE_LOGS__.push(entry);
        if (window.__ORGII_CONSOLE_LOGS__.length > MAX_LOGS) {
            window.__ORGII_CONSOLE_LOGS__.shift();
        }
    };

    // Intercept console methods
    ['log', 'warn', 'error', 'info', 'debug', 'trace'].forEach(function(level) {
        const original = console[level];
        console[level] = function() {
            const args = Array.prototype.slice.call(arguments);

            // Skip our own initialization log
            if (args[0] && typeof args[0] === 'string' && args[0].indexOf('[Orgii]') === 0) {
                return original.apply(console, args);
            }

            const stack = (level === 'error' || level === 'trace')
                ? (new Error()).stack
                : null;
            addLog(level, args, stack);
            return original.apply(console, args);
        };
    });

    // Capture uncaught errors
    window.addEventListener('error', function(e) {
        // Skip if it's a script error we can't access (CORS)
        if (e.message === 'Script error.' && !e.filename) return;

        const stack = (e.error && e.error.stack) || ('at ' + e.filename + ':' + e.lineno + ':' + e.colno);
        addLog('error', ['Uncaught ' + ((e.error && e.error.name) || 'Error') + ': ' + e.message], stack);
    });

    // Capture unhandled promise rejections
    window.addEventListener('unhandledrejection', function(e) {
        const reason = e.reason;
        const message = (reason instanceof Error)
            ? (reason.name + ': ' + reason.message)
            : String(reason);
        const stack = (reason instanceof Error) ? reason.stack : null;
        addLog('error', ['Unhandled Promise Rejection: ' + message], stack);
    });

    // Capture CSP violations
    document.addEventListener('securitypolicyviolation', function(e) {
        addLog('warn', [
            'CSP Violation: ' + e.violatedDirective,
            'Blocked: ' + (e.blockedURI || 'inline')
        ], null);
    });

    // Capture resource load errors (images, scripts, etc.)
    window.addEventListener('error', function(e) {
        var target = e.target;
        if (target !== window && target && target.tagName) {
            var tag = target.tagName.toLowerCase();
            var src = target.src || target.href || 'unknown';
            addLog('warn', ['Failed to load ' + tag + ': ' + src], null);
        }
    }, true);

    // Function to retrieve and clear logs (called via webview.eval)
    window.__ORGII_GET_AND_CLEAR_LOGS__ = function() {
        var logs = window.__ORGII_CONSOLE_LOGS__;
        window.__ORGII_CONSOLE_LOGS__ = [];
        return JSON.stringify(logs);
    };

    console.log('[Orgii] Console capture initialized');
})();
"#;

/// JavaScript for capturing network requests (fetch and XMLHttpRequest)
///
/// Intercepts fetch and XHR calls, storing request/response info
/// in a global array that can be retrieved via webview.eval().
pub const NETWORK_CAPTURE_SCRIPT: &str = r#"
(function() {
    if (window.__ORGII_NETWORK_CAPTURE__) return;
    window.__ORGII_NETWORK_CAPTURE__ = true;

    const MAX_REQUESTS = 200;
    window.__ORGII_NETWORK_LOGS__ = [];

    const addNetworkLog = (entry) => {
        window.__ORGII_NETWORK_LOGS__.push(entry);
        if (window.__ORGII_NETWORK_LOGS__.length > MAX_REQUESTS) {
            window.__ORGII_NETWORK_LOGS__.shift();
        }
    };

    const generateId = () => Date.now() + '-' + Math.random().toString(36).slice(2, 8);

    // ============================================
    // Intercept fetch
    // ============================================
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
        const startTime = Date.now();
        const url = typeof input === 'string' ? input : (input.url || String(input));
        const method = (init && init.method) ? init.method.toUpperCase() : 'GET';

        const entry = {
            id: generateId(),
            type: 'fetch',
            method: method,
            url: url,
            startTime: startTime,
            status: null,
            duration: null,
            size: null,
            error: null
        };

        return originalFetch.apply(this, arguments)
            .then(function(response) {
                entry.status = response.status;
                entry.duration = Date.now() - startTime;
                entry.size = response.headers.get('content-length');
                addNetworkLog(entry);
                return response;
            })
            .catch(function(error) {
                entry.error = error.message || 'Network error';
                entry.duration = Date.now() - startTime;
                addNetworkLog(entry);
                throw error;
            });
    };

    // ============================================
    // Intercept XMLHttpRequest
    // ============================================
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this.__orgii_method = method ? method.toUpperCase() : 'GET';
        this.__orgii_url = url;
        this.__orgii_id = generateId();
        return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        var xhr = this;
        var startTime = Date.now();

        var entry = {
            id: xhr.__orgii_id || generateId(),
            type: 'xhr',
            method: xhr.__orgii_method || 'GET',
            url: xhr.__orgii_url || '',
            startTime: startTime,
            status: null,
            duration: null,
            size: null,
            error: null
        };

        xhr.addEventListener('load', function() {
            entry.status = xhr.status;
            entry.duration = Date.now() - startTime;
            entry.size = xhr.getResponseHeader('content-length');
            addNetworkLog(entry);
        });

        xhr.addEventListener('error', function() {
            entry.error = 'Network error';
            entry.duration = Date.now() - startTime;
            addNetworkLog(entry);
        });

        xhr.addEventListener('abort', function() {
            entry.error = 'Request aborted';
            entry.duration = Date.now() - startTime;
            addNetworkLog(entry);
        });

        xhr.addEventListener('timeout', function() {
            entry.error = 'Request timed out';
            entry.duration = Date.now() - startTime;
            addNetworkLog(entry);
        });

        return originalXHRSend.apply(this, arguments);
    };

    // Function to retrieve and clear network logs (called via webview.eval)
    window.__ORGII_GET_AND_CLEAR_NETWORK_LOGS__ = function() {
        var logs = window.__ORGII_NETWORK_LOGS__;
        window.__ORGII_NETWORK_LOGS__ = [];
        return JSON.stringify(logs);
    };

    console.log('[Orgii] Network capture initialized');
})();
"#;
