//! Anti-Bot Detection Script
//!
//! Platform-aware initialization that runs before any page scripts
//! to ensure proper fingerprinting and avoid bot detection.

/// Comprehensive anti-bot-detection script
///
/// Platforms:
/// - macOS: WKWebView (Safari) - vendor = "Apple Computer, Inc."
/// - Windows: WebView2 (Chromium/Edge) - vendor = "Google Inc."
/// - Linux: WebKitGTK - vendor = "Google Inc." (Chrome-compatible)
pub const ANTI_BOT_DETECTION_SCRIPT: &str = r#"
(function() {
    if (window.__ORGII_INIT__) return;
    window.__ORGII_INIT__ = true;

    // ============================================
    // Platform Detection
    // ============================================
    const platform = navigator.platform?.toLowerCase() || '';
    const ua = navigator.userAgent?.toLowerCase() || '';
    const isMac = platform.includes('mac') || ua.includes('macintosh');
    const isWindows = platform.includes('win') || ua.includes('windows');
    const isLinux = !isMac && !isWindows;
    const isChromium = !isMac; // Windows/Linux use Chromium-based engines

    // ============================================
    // 1. Core Navigator Properties
    // ============================================

    // Remove webdriver flag (primary bot indicator)
    try {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true
        });
    } catch (e) {}

    // Platform-specific vendor
    try {
        const expectedVendor = isMac ? 'Apple Computer, Inc.' : 'Google Inc.';
        Object.defineProperty(navigator, 'vendor', {
            get: () => expectedVendor,
            configurable: true
        });
    } catch (e) {}

    // Ensure plugins array looks normal
    try {
        if (!navigator.plugins || navigator.plugins.length === 0) {
            const createPlugin = (name, desc, filename) => ({
                name, description: desc, filename,
                length: 1,
                item: () => ({ type: 'application/pdf' }),
                namedItem: () => ({ type: 'application/pdf' }),
                [0]: { type: 'application/pdf', suffixes: 'pdf', description: desc }
            });
            const plugins = {
                length: 5,
                item: (i) => plugins[i],
                namedItem: (n) => plugins[n],
                refresh: () => {},
                0: createPlugin('PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
                1: createPlugin('Chrome PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
                2: createPlugin('Chromium PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
                3: createPlugin('Microsoft Edge PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
                4: createPlugin('WebKit built-in PDF', 'Portable Document Format', 'internal-pdf-viewer')
            };
            Object.defineProperty(navigator, 'plugins', { get: () => plugins, configurable: true });
        }
    } catch (e) {}

    // Languages
    try {
        if (!navigator.languages || navigator.languages.length === 0) {
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
                configurable: true
            });
        }
    } catch (e) {}

    // Hardware properties (Chromium only - Safari doesn't have deviceMemory)
    try {
        if (isChromium && navigator.deviceMemory === undefined) {
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8, configurable: true });
        }
    } catch (e) {}

    try {
        if (!navigator.hardwareConcurrency || navigator.hardwareConcurrency < 2) {
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8, configurable: true });
        }
    } catch (e) {}

    // Connection API (Chromium only)
    try {
        if (isChromium && !navigator.connection) {
            Object.defineProperty(navigator, 'connection', {
                get: () => ({
                    effectiveType: '4g',
                    rtt: 50,
                    downlink: 10,
                    saveData: false,
                    onchange: null
                }),
                configurable: true
            });
        }
    } catch (e) {}

    // ============================================
    // 2. Remove Automation Markers
    // ============================================
    try {
        // Selenium
        delete window._selenium;
        delete window.__webdriver_script_fn;
        delete window.__driver_evaluate;
        delete window.__webdriver_evaluate;
        delete window.__selenium_evaluate;
        delete window.__fxdriver_evaluate;
        delete window.__driver_unwrapped;
        delete window.__webdriver_unwrapped;
        delete window.__selenium_unwrapped;
        delete window.__fxdriver_unwrapped;
        delete window._Selenium_IDE_Recorder;
        delete window._WEBDRIVER_ELEM_CACHE;
        delete document.__webdriver_script_fn;
        delete document.$cdc_asdjflasutopfhvcZLmcfl_;
        delete document.$chrome_asyncScriptInfo;

        // Puppeteer/Playwright
        delete window.__puppeteer_evaluation_script__;
        delete window.__playwright;

        // PhantomJS/Nightmare
        delete window._phantom;
        delete window.__nightmare;
        delete window.callPhantom;
        delete window.callSelenium;
    } catch (e) {}

    // ============================================
    // 3. Browser-Specific Objects
    // ============================================
    try {
        if (isChromium && !window.chrome) {
            // Chromium browsers should have window.chrome
            window.chrome = {
                app: {
                    isInstalled: false,
                    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
                    getDetails: () => null,
                    getIsInstalled: () => false,
                    installState: (cb) => cb && cb('disabled')
                },
                runtime: {
                    OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
                    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
                    PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                    PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                    RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
                    connect: () => ({ onDisconnect: { addListener: () => {} }, onMessage: { addListener: () => {} }, postMessage: () => {} }),
                    sendMessage: () => {},
                    id: undefined
                },
                csi: () => ({}),
                loadTimes: () => ({
                    commitLoadTime: Date.now() / 1000,
                    connectionInfo: 'http/1.1',
                    finishDocumentLoadTime: Date.now() / 1000,
                    finishLoadTime: Date.now() / 1000,
                    firstPaintAfterLoadTime: 0,
                    firstPaintTime: Date.now() / 1000,
                    navigationType: 'Other',
                    npnNegotiatedProtocol: 'unknown',
                    requestTime: Date.now() / 1000,
                    startLoadTime: Date.now() / 1000,
                    wasAlternateProtocolAvailable: false,
                    wasFetchedViaSpdy: false,
                    wasNpnNegotiated: false
                })
            };
        } else if (isMac && window.chrome) {
            // Safari shouldn't have window.chrome
            delete window.chrome;
        }
    } catch (e) {}

    // ============================================
    // 4. Permissions API
    // ============================================
    try {
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = function(parameters) {
            if (parameters.name === 'notifications') {
                return Promise.resolve({ state: Notification.permission || 'prompt', onchange: null });
            }
            return originalQuery.call(this, parameters);
        };
    } catch (e) {}

    // ============================================
    // 5. Screen Properties
    // ============================================
    try {
        // Ensure screen properties are reasonable
        if (!screen.availWidth || screen.availWidth === 0) {
            Object.defineProperty(screen, 'availWidth', { get: () => screen.width, configurable: true });
        }
        if (!screen.availHeight || screen.availHeight === 0) {
            Object.defineProperty(screen, 'availHeight', { get: () => screen.height - 40, configurable: true });
        }
        // Standard color depth
        if (screen.colorDepth !== 24 && screen.colorDepth !== 30 && screen.colorDepth !== 32) {
            Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
            Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });
        }
    } catch (e) {}

    // ============================================
    // 6. WebGL Renderer (prevent fingerprint mismatch)
    // ============================================
    try {
        const webglVendor = isMac ? 'Apple Inc.' : 'Google Inc. (NVIDIA)';
        const webglRenderer = isMac ? 'Apple GPU' : 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, OpenGL 4.5)';

        const getParameterHandler = {
            apply: function(target, thisArg, args) {
                const param = args[0];
                // UNMASKED_VENDOR_WEBGL
                if (param === 37445) return webglVendor;
                // UNMASKED_RENDERER_WEBGL
                if (param === 37446) return webglRenderer;
                return Reflect.apply(target, thisArg, args);
            }
        };

        if (WebGLRenderingContext.prototype.getParameter) {
            WebGLRenderingContext.prototype.getParameter = new Proxy(
                WebGLRenderingContext.prototype.getParameter,
                getParameterHandler
            );
        }
        if (typeof WebGL2RenderingContext !== 'undefined' && WebGL2RenderingContext.prototype.getParameter) {
            WebGL2RenderingContext.prototype.getParameter = new Proxy(
                WebGL2RenderingContext.prototype.getParameter,
                getParameterHandler
            );
        }
    } catch (e) {}

    // ============================================
    // 7. Notification Permission
    // ============================================
    try {
        if (Notification.permission === 'denied') {
            Object.defineProperty(Notification, 'permission', {
                get: () => 'default',
                configurable: true
            });
        }
    } catch (e) {}

    // ============================================
    // 8. Performance Timing (reduce precision to match real browsers)
    // ============================================
    try {
        const originalNow = performance.now.bind(performance);
        performance.now = function() {
            // Reduce to 0.1ms precision (real browsers have reduced precision for security)
            return Math.round(originalNow() * 10) / 10;
        };
    } catch (e) {}

    // ============================================
    // 9. Link Interception
    // ============================================
    document.addEventListener('click', function(e) {
        let target = e.target;
        while (target && target.tagName !== 'A') {
            target = target.parentElement;
        }
        if (target && target.tagName === 'A') {
            const href = target.getAttribute('href');
            const targetAttr = target.getAttribute('target');
            if (targetAttr === '_blank' && href) {
                e.preventDefault();
                e.stopPropagation();
                window.open(href, '_blank');
                return false;
            }
        }
    }, true);

    console.log('[Orgii] Anti-detection initialized - Platform:', isMac ? 'macOS/Safari' : isWindows ? 'Windows/Edge' : 'Linux/Chrome');
})();
"#;
