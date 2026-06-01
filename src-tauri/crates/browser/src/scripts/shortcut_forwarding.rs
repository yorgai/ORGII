//! Shortcut forwarding for inline webviews.

pub const SHORTCUT_FORWARDING_SCRIPT: &str = r#"
(function() {
    if (window.__ORGII_SHORTCUT_FORWARDING__) return;
    window.__ORGII_SHORTCUT_FORWARDING__ = true;

    const SHORTCUTS = {
        'Equal': { shortcut: 'zoomIn', keys: 'CmdOrCtrl+=' },
        'NumpadAdd': { shortcut: 'zoomIn', keys: 'CmdOrCtrl+=' },
        'Minus': { shortcut: 'zoomOut', keys: 'CmdOrCtrl+-' },
        'NumpadSubtract': { shortcut: 'zoomOut', keys: 'CmdOrCtrl+-' },
        'Digit0': { shortcut: 'zoomReset', keys: 'CmdOrCtrl+0' },
        'Numpad0': { shortcut: 'zoomReset', keys: 'CmdOrCtrl+0' }
    };

    const getShortcut = (event) => {
        if (event.code === 'KeyP') {
            if (event.shiftKey) {
                return { shortcut: 'toggleSpotlight', keys: 'CmdOrCtrl+Shift+P' };
            }
            return { shortcut: 'openFilePalette', keys: 'CmdOrCtrl+P' };
        }
        if (event.shiftKey) return null;
        return SHORTCUTS[event.code] || null;
    };

    const emitShortcut = (detail) => {
        if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.emit) {
            window.__TAURI__.event.emit('inline-webview-shortcut', detail);
            return;
        }
        window.open('orgii-shortcut://' + encodeURIComponent(detail.shortcut));
    };

    window.addEventListener('keydown', function(event) {
        if (event.isComposing || event.defaultPrevented) return;

        const modifierPressed = event.metaKey || event.ctrlKey;
        if (!modifierPressed || event.altKey) return;

        const shortcut = getShortcut(event);
        if (!shortcut) return;

        event.preventDefault();
        event.stopPropagation();
        emitShortcut(shortcut);
    }, true);
})();
"#;
