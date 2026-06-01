//! ORGII Preview Commands
//!
//! Provides Tauri commands for managing the ORGII component preview webview.
//! The preview renders isolated React components with customizable props.
//!
//! ## Workflow
//! 1. Create preview webview pointing to webpack dev server's orgii-preview.html
//! 2. Load component via eval() calling `__ORGII_LOAD_COMPONENT__`
//! 3. Update props via eval() calling `__ORGII_UPDATE_ARGS__`
//!
//! @see Documentation/Architecture-Guide/orgii-editor/orgii-story-format-0130.md

use tauri::webview::WebviewBuilder;
use tauri::WebviewUrl;
use tauri::{AppHandle, Manager};

use super::logging::eval_js_with_result;

/// Default preview webview label
const PREVIEW_LABEL: &str = "orgii-preview";

/// Create or get the ORGII preview webview.
///
/// Creates an inline webview for component preview if it doesn't exist,
/// or returns the existing one's label.
///
/// # Arguments
/// - `parent_window`: The parent window label (usually "main")
/// - `x`, `y`, `width`, `height`: Position and size in logical pixels
/// - `dev_server_port`: Port where webpack dev server is running (default 1998)
///
/// # Returns
/// The webview label
#[tauri::command]
pub async fn create_orgii_preview(
    app: AppHandle,
    parent_window: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    dev_server_port: Option<u16>,
) -> Result<String, String> {
    let port = dev_server_port.unwrap_or(1998);
    let preview_url = format!("http://localhost:{}/soyd-preview.html", port);

    println!(
        "[ORGII Preview] Creating preview webview at ({}, {}) size {}x{}",
        x, y, width, height
    );

    // Get the parent window
    let window = app.get_window(&parent_window).ok_or_else(|| {
        let windows: Vec<_> = app.windows().keys().cloned().collect();
        format!(
            "Parent window '{}' not found. Available: {:?}",
            parent_window, windows
        )
    })?;

    // Check if webview already exists
    if let Some(existing) = app.get_webview(PREVIEW_LABEL) {
        println!("[ORGII Preview] Preview webview already exists, reusing");

        // Update position and show
        let pos = tauri::LogicalPosition::new(x, y);
        let size = tauri::LogicalSize::new(width, height);
        let _ = existing.set_position(pos);
        let _ = existing.set_size(size);
        let _ = existing.show();

        return Ok(PREVIEW_LABEL.to_string());
    }

    // Build the preview webview
    let builder = WebviewBuilder::new(
        PREVIEW_LABEL,
        WebviewUrl::External(
            preview_url
                .parse()
                .map_err(|e| format!("Invalid URL: {}", e))?,
        ),
    )
    .auto_resize();

    // Create the webview
    let position = tauri::Position::Logical(tauri::LogicalPosition::new(x, y));
    let size = tauri::Size::Logical(tauri::LogicalSize::new(width, height));

    let webview = window
        .add_child(builder, position, size)
        .map_err(|e| format!("Failed to create preview webview: {}", e))?;

    println!(
        "[ORGII Preview] Successfully created preview webview: {}",
        webview.label()
    );

    Ok(PREVIEW_LABEL.to_string())
}

/// Load a component into the preview webview.
///
/// Calls `__ORGII_LOAD_COMPONENT__` in the preview page to dynamically import
/// and render the specified component.
///
/// # Arguments
/// - `component_path`: Path to the component file (relative to src/)
/// - `component_name`: Export name of the component
/// - `project_name`: Optional project name (for display)
/// - `args`: Initial props to pass to the component
///
/// # Returns
/// Ok if the load command was sent successfully
#[tauri::command]
pub async fn orgii_preview_load_component(
    app: AppHandle,
    component_path: String,
    component_name: String,
    project_name: Option<String>,
    args: serde_json::Value,
) -> Result<(), String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found. Call create_orgii_preview first.".to_string())?;

    // Escape strings for JavaScript
    let escaped_path = component_path.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_name = component_name.replace('\\', "\\\\").replace('\'', "\\'");
    let escaped_project = project_name
        .map(|s| format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'")))
        .unwrap_or_else(|| "null".to_string());
    let args_json = args.to_string();

    let script = format!(
        r#"
        if (typeof window.__ORGII_LOAD_COMPONENT__ === 'function') {{
            window.__ORGII_LOAD_COMPONENT__('{}', '{}', {}, {});
        }} else {{
            console.error('[ORGII Preview] __ORGII_LOAD_COMPONENT__ not available');
        }}
        "#,
        escaped_path, escaped_name, escaped_project, args_json
    );

    webview
        .eval(&script)
        .map_err(|e| format!("Failed to execute load script: {}", e))?;

    println!(
        "[ORGII Preview] Loading component: {} from {}",
        component_name, component_path
    );

    Ok(())
}

/// Update props in the preview webview.
///
/// Calls `__ORGII_UPDATE_ARGS__` to merge new args with existing ones.
///
/// # Arguments
/// - `args`: Props to merge with current args
#[tauri::command]
pub async fn orgii_preview_update_args(
    app: AppHandle,
    args: serde_json::Value,
) -> Result<(), String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found".to_string())?;

    let args_json = args.to_string();

    let script = format!(
        r#"
        if (typeof window.__ORGII_UPDATE_ARGS__ === 'function') {{
            window.__ORGII_UPDATE_ARGS__({});
        }}
        "#,
        args_json
    );

    webview
        .eval(&script)
        .map_err(|e| format!("Failed to update args: {}", e))?;

    Ok(())
}

/// Set all props in the preview webview.
///
/// Calls `__ORGII_SET_ARGS__` to replace all args.
///
/// # Arguments
/// - `args`: Complete props object
#[tauri::command]
pub async fn orgii_preview_set_args(app: AppHandle, args: serde_json::Value) -> Result<(), String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found".to_string())?;

    let args_json = args.to_string();

    let script = format!(
        r#"
        if (typeof window.__ORGII_SET_ARGS__ === 'function') {{
            window.__ORGII_SET_ARGS__({});
        }}
        "#,
        args_json
    );

    webview
        .eval(&script)
        .map_err(|e| format!("Failed to set args: {}", e))?;

    Ok(())
}

/// Get the current preview state.
///
/// Returns the status, component info, and current args.
#[tauri::command]
pub async fn orgii_preview_get_state(app: AppHandle) -> Result<serde_json::Value, String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found".to_string())?;

    let result = eval_js_with_result(
        &webview,
        "JSON.stringify(window.__ORGII_STATE__ || { status: 'not_ready' })",
        r#"{"status":"not_ready"}"#,
    )
    .await;

    println!("[ORGII Preview] Get state result: {}", result);

    serde_json::from_str(&result).map_err(|e| format!("Failed to parse state: {}", e))
}

/// Reset the preview to idle state.
#[tauri::command]
pub async fn orgii_preview_reset(app: AppHandle) -> Result<(), String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found".to_string())?;

    let script = r#"
        if (typeof window.__ORGII_RESET__ === 'function') {
            window.__ORGII_RESET__();
        }
    "#;

    webview
        .eval(script)
        .map_err(|e| format!("Failed to reset: {}", e))?;

    Ok(())
}

/// Show the preview webview.
#[tauri::command]
pub fn orgii_preview_show(app: AppHandle) -> Result<(), String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found".to_string())?;

    webview.show().map_err(|e| format!("Failed to show: {}", e))
}

/// Hide the preview webview.
#[tauri::command]
pub fn orgii_preview_hide(app: AppHandle) -> Result<(), String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found".to_string())?;

    webview.hide().map_err(|e| format!("Failed to hide: {}", e))
}

/// Update the position and size of the preview webview.
#[tauri::command]
pub fn orgii_preview_update_position(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found".to_string())?;

    let pos = tauri::LogicalPosition::new(x, y);
    let size = tauri::LogicalSize::new(width, height);

    webview
        .set_position(pos)
        .map_err(|e| format!("Failed to set position: {}", e))?;
    webview
        .set_size(size)
        .map_err(|e| format!("Failed to set size: {}", e))?;

    Ok(())
}

/// Inject CSS into the preview webview.
///
/// Injects CSS tokens/variables dynamically into the preview.
/// Uses retry mechanism to wait for React app to mount.
///
/// # Arguments
/// - `css`: CSS string to inject (e.g., `:root { --primary-6: 255, 0, 0; }`)
#[tauri::command]
pub async fn orgii_preview_inject_css(app: AppHandle, css: String) -> Result<(), String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found".to_string())?;

    // Escape the CSS for JavaScript
    let escaped_css = css
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace("${", "\\${")
        .replace('\n', "\\n")
        .replace('\r', "");

    // Use a retry mechanism since React might not have mounted yet
    let script = format!(
        r#"
        (function() {{
            var css = `{}`;
            var attempts = 0;
            var maxAttempts = 20;

            function tryInject() {{
                attempts++;
                if (typeof window.__ORGII_INJECT_CSS__ === 'function') {{
                    window.__ORGII_INJECT_CSS__(css);
                    console.log('[ORGII Preview] Token CSS injected after', attempts, 'attempt(s)');
                }} else if (attempts < maxAttempts) {{
                    setTimeout(tryInject, 100);
                }} else {{
                    console.error('[ORGII Preview] Failed to inject token CSS after', maxAttempts, 'attempts');
                }}
            }}

            tryInject();
        }})();
        "#,
        escaped_css
    );

    webview
        .eval(&script)
        .map_err(|e| format!("Failed to inject CSS: {}", e))?;

    println!("[ORGII Preview] Injected CSS ({} chars)", css.len());

    Ok(())
}

/// Inject component CSS into the preview webview.
///
/// Injects component-specific styles (SCSS/CSS rules) into a separate style element.
/// This is separate from token injection to avoid overwriting design tokens.
/// Directly manipulates the DOM - no React dependency.
///
/// # Arguments
/// - `css`: CSS string containing component styles
#[tauri::command]
pub async fn orgii_preview_inject_component_css(app: AppHandle, css: String) -> Result<(), String> {
    let webview = app
        .get_webview(PREVIEW_LABEL)
        .ok_or_else(|| "Preview webview not found".to_string())?;

    // Add !important to key CSS properties in Rust (more reliable than JS regex)
    // This ensures injected styles win specificity battles with bundled CSS
    let css_with_important = add_important_to_css(&css);

    // Escape the CSS for JavaScript - handle backticks and template literals
    let escaped_css = css_with_important
        .replace('\\', "\\\\")
        .replace('`', "\\`")
        .replace("${", "\\${")
        .replace('\n', "\\n")
        .replace('\r', "");

    let script = format!(
        r#"
        (function() {{
            var css = `{}`;
            var styleId = 'orgii-component-styles';
            var styleEl = document.getElementById(styleId);

            if (!styleEl) {{
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                document.head.appendChild(styleEl);
            }}

            styleEl.textContent = css;
            console.log('[ORGII Preview] Injected component CSS:', css.length, 'chars');
        }})();
        "#,
        escaped_css
    );

    webview
        .eval(&script)
        .map_err(|e| format!("Failed to inject component CSS: {}", e))?;

    println!(
        "[ORGII Preview] Injected component CSS ({} chars)",
        css.len()
    );

    Ok(())
}

/// Close the preview webview.
#[tauri::command]
pub fn orgii_preview_close(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(PREVIEW_LABEL) {
        webview
            .close()
            .map_err(|e| format!("Failed to close: {}", e))?;
        println!("[ORGII Preview] Closed preview webview");
    }
    Ok(())
}

/// Compile component styles (SCSS/CSS) and return CSS string.
///
/// Takes a component file path and finds its associated style file,
/// compiles SCSS to CSS if needed, and returns the CSS string.
///
/// # Arguments
/// - `repo_path`: Root path of the repository
/// - `component_path`: Path to the component file (e.g., "src/components/Checkbox/index.tsx")
///
/// # Returns
/// Compiled CSS string, or empty string if no styles found
#[tauri::command]
pub async fn compile_component_styles(
    repo_path: String,
    component_path: String,
) -> Result<String, String> {
    use std::path::PathBuf;

    println!("[ORGII Preview] compile_component_styles called:");
    println!("  repo_path: {}", repo_path);
    println!("  component_path: {}", component_path);

    let repo = PathBuf::from(&repo_path);
    let component = PathBuf::from(&component_path);

    // Get the component directory
    let component_dir = component.parent().unwrap_or(&component);

    println!("  component_dir: {:?}", component_dir);

    // Try to find style files in order of preference
    let style_candidates = [
        component_dir.join("index.scss"),
        component_dir.join("index.css"),
        component_dir.join("styles.scss"),
        component_dir.join("styles.css"),
        // Also try component-named files (e.g., Checkbox.scss)
        component_dir.join(format!(
            "{}.scss",
            component_dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        )),
        component_dir.join(format!(
            "{}.css",
            component_dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        )),
    ];

    let mut compiled_css = String::new();

    for candidate in &style_candidates {
        let full_path = repo.join(candidate);
        println!(
            "[ORGII Preview] Checking: {:?} -> exists: {}",
            full_path,
            full_path.exists()
        );

        if full_path.exists() {
            println!("[ORGII Preview] Found style file: {:?}", full_path);

            let content = std::fs::read_to_string(&full_path)
                .map_err(|e| format!("Failed to read style file: {}", e))?;

            let css = if full_path.extension().map(|e| e == "scss").unwrap_or(false) {
                // Compile SCSS to CSS
                compile_scss(&content, &full_path)?
            } else {
                // Already CSS
                content
            };

            compiled_css.push_str(&css);
            compiled_css.push('\n');

            // Only use the first found style file
            break;
        }
    }

    if compiled_css.is_empty() {
        println!(
            "[ORGII Preview] No style file found for component: {}",
            component_path
        );
    } else {
        println!(
            "[ORGII Preview] Compiled {} chars of CSS for: {}",
            compiled_css.len(),
            component_path
        );
    }

    Ok(compiled_css)
}

/// Compile SCSS string to CSS using grass
fn compile_scss(scss: &str, source_path: &std::path::Path) -> Result<String, String> {
    use grass::{Options, OutputStyle};

    // Get the directory for @import resolution
    let load_path = source_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();

    let options = Options::default()
        .style(OutputStyle::Expanded)
        .load_path(&load_path);

    grass::from_string(scss, &options).map_err(|e| format!("SCSS compilation error: {}", e))
}

/// Add !important to key CSS properties to ensure injected styles win specificity battles
///
/// Modifies background, background-color, border-color, and color properties
fn add_important_to_css(css: &str) -> String {
    use regex::Regex;

    let mut result = css.to_string();

    // Patterns for properties that commonly use design tokens
    // Match: property: value; (but not if already has !important)
    let patterns = [
        r"(background(?:-color)?:\s*)([^;!]+)(;)",
        r"(border-color:\s*)([^;!]+)(;)",
        r"(\bcolor:\s*)([^;!]+)(;)",
    ];

    for pattern in patterns {
        if let Ok(re) = Regex::new(pattern) {
            result = re.replace_all(&result, "$1$2 !important$3").to_string();
        }
    }

    result
}

/// Compile multiple style files and return combined CSS.
///
/// Useful for loading global styles + component styles together.
///
/// # Arguments
/// - `repo_path`: Root path of the repository
/// - `style_paths`: List of style file paths relative to repo root
///
/// # Returns
/// Combined compiled CSS string
#[tauri::command]
pub async fn compile_style_files(
    repo_path: String,
    style_paths: Vec<String>,
) -> Result<String, String> {
    use std::path::PathBuf;

    let repo = PathBuf::from(&repo_path);
    let mut combined_css = String::new();
    let num_files = style_paths.len();

    for style_path in &style_paths {
        let full_path = repo.join(style_path);

        if !full_path.exists() {
            println!("[ORGII Preview] Style file not found: {:?}", full_path);
            continue;
        }

        let content = std::fs::read_to_string(&full_path)
            .map_err(|e| format!("Failed to read {}: {}", style_path, e))?;

        let css = if full_path.extension().map(|e| e == "scss").unwrap_or(false) {
            compile_scss(&content, &full_path)?
        } else {
            content
        };

        combined_css.push_str(&format!("/* {} */\n", style_path));
        combined_css.push_str(&css);
        combined_css.push_str("\n\n");
    }

    println!(
        "[ORGII Preview] Compiled {} style files, {} chars total",
        num_files,
        combined_css.len()
    );

    Ok(combined_css)
}
