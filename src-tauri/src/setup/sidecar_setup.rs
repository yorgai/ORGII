//! First-run sidecar download: fetches peekaboo, agent-browser, and bundled
//! git from their respective GitHub Releases into `~/.orgii/bin/` so they
//! are never bundled inside the notarized `.app` bundle.
//!
//! Runs non-blocking at startup; the app is fully usable while downloads
//! proceed. Each binary has an idempotency guard so re-runs are instant.

use std::path::{Path, PathBuf};

use tokio::io::AsyncWriteExt;
use tracing::{info, warn};

const AGENT_BROWSER_VERSION: &str = "v0.27.2";
const PEEKABOO_VERSION: &str = "v3.2.3";
/// Release tag used in the dugite-native download URL path.
const DUGITE_TAG: &str = "v2.53.0-3";
/// Asset-name version stem. dugite-native embeds a short git build hash in
/// every asset name (not the tag suffix), so this must be updated together
/// with `DUGITE_TAG` whenever the pinned release changes.
const DUGITE_ASSET_VERSION: &str = "v2.53.0-f49d009";

const PLACEHOLDER_MARKER: &[u8] = b"ORGII_GENERATED_OPTIONAL_SIDECAR_PLACEHOLDER";

/// Spawn the sidecar download task in the Tauri/Tokio background.
/// Returns immediately; errors are logged, never fatal.
pub fn spawn_sidecar_setup() {
    tauri::async_runtime::spawn(async {
        if let Err(err) = run_sidecar_setup().await {
            warn!("[sidecar_setup] setup failed: {err}");
        }
    });
}

async fn run_sidecar_setup() -> Result<(), String> {
    let bin_dir = app_paths::sidecar_bin_dir();
    tokio::fs::create_dir_all(&bin_dir)
        .await
        .map_err(|err| format!("failed to create sidecar bin dir: {err}"))?;

    let client = build_client()?;
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    install_agent_browser(&client, &bin_dir, os, arch).await?;

    #[cfg(target_os = "macos")]
    install_peekaboo(&client, &bin_dir).await?;

    install_bundled_git(&client, &bin_dir, os, arch).await?;

    info!(
        "[sidecar_setup] all sidecars ready in {}",
        bin_dir.display()
    );
    Ok(())
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("orgii-sidecar-setup/1.0")
        .timeout(std::time::Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|err| format!("failed to build HTTP client: {err}"))
}

// ─── agent-browser ───────────────────────────────────────────────────────────

async fn install_agent_browser(
    client: &reqwest::Client,
    bin_dir: &Path,
    os: &str,
    arch: &str,
) -> Result<(), String> {
    let (asset, dest_name) = agent_browser_target(os, arch)?;
    let dest = bin_dir.join(&dest_name);

    if is_real_binary(&dest) {
        info!("[sidecar_setup] agent-browser already present");
        return Ok(());
    }

    let url = format!(
        "https://github.com/vercel-labs/agent-browser/releases/download/{AGENT_BROWSER_VERSION}/{asset}"
    );
    download_to(client, &url, &dest).await?;
    set_executable(&dest)?;
    info!(
        "[sidecar_setup] installed agent-browser → {}",
        dest.display()
    );
    Ok(())
}

fn agent_browser_target(os: &str, arch: &str) -> Result<(String, String), String> {
    let pair = match (os, arch) {
        ("macos", "aarch64") => (
            "agent-browser-darwin-arm64",
            "agent-browser-aarch64-apple-darwin",
        ),
        ("macos", "x86_64") => (
            "agent-browser-darwin-x64",
            "agent-browser-x86_64-apple-darwin",
        ),
        ("linux", "x86_64") => (
            "agent-browser-linux-x64",
            "agent-browser-x86_64-unknown-linux-gnu",
        ),
        ("windows", "x86_64") => (
            "agent-browser-win32-x64.exe",
            "agent-browser-x86_64-pc-windows-msvc.exe",
        ),
        _ => return Err(format!("agent-browser: unsupported platform {os}/{arch}")),
    };
    Ok((pair.0.to_string(), pair.1.to_string()))
}

// ─── peekaboo (macOS only) ───────────────────────────────────────────────────

#[cfg(target_os = "macos")]
async fn install_peekaboo(client: &reqwest::Client, bin_dir: &Path) -> Result<(), String> {
    let dest = bin_dir.join("peekaboo");
    let dest_aarch64 = bin_dir.join("peekaboo-aarch64-apple-darwin");
    let dest_x86 = bin_dir.join("peekaboo-x86_64-apple-darwin");

    if is_real_binary(&dest) && is_real_binary(&dest_aarch64) {
        info!("[sidecar_setup] peekaboo already present");
        return Ok(());
    }

    let url = format!(
        "https://github.com/steipete/peekaboo/releases/download/{PEEKABOO_VERSION}/peekaboo-macos-universal.tar.gz"
    );

    let tmp_dir = temp_dir_in(bin_dir, "peekaboo")?;
    let archive = tmp_dir.join("peekaboo-macos-universal.tar.gz");
    download_to(client, &url, &archive).await?;

    // Extract with system tar (always available on macOS)
    run_tar_extract(&archive, &tmp_dir)?;

    // Find the peekaboo binary inside the extracted tree
    let binary = find_file_named(&tmp_dir, "peekaboo")
        .ok_or_else(|| "peekaboo binary not found in archive".to_string())?;

    let bytes = tokio::fs::read(&binary)
        .await
        .map_err(|err| format!("read extracted peekaboo: {err}"))?;

    for dest_path in [&dest, &dest_aarch64, &dest_x86] {
        tokio::fs::write(dest_path, &bytes)
            .await
            .map_err(|err| format!("write {}: {err}", dest_path.display()))?;
        set_executable(dest_path)?;
    }

    // Write VERSION marker
    tokio::fs::write(
        bin_dir.join("peekaboo-VERSION"),
        format!("{PEEKABOO_VERSION}\n"),
    )
    .await
    .map_err(|err| format!("write peekaboo-VERSION: {err}"))?;

    // Clean up temp dir
    let _ = tokio::fs::remove_dir_all(&tmp_dir).await;

    info!("[sidecar_setup] installed peekaboo → {}", dest.display());
    Ok(())
}

// ─── dugite bundled git ───────────────────────────────────────────────────────

async fn install_bundled_git(
    client: &reqwest::Client,
    bin_dir: &Path,
    os: &str,
    arch: &str,
) -> Result<(), String> {
    let git_dir = bin_dir.join("git");
    let git_exec = git_dir.join("bin").join(git_binary_name());

    if git_exec.is_file() && !is_placeholder_bytes(&std::fs::read(&git_exec).unwrap_or_default()) {
        info!("[sidecar_setup] bundled git already present");
        return Ok(());
    }

    let asset = dugite_asset(os, arch)?;
    let url =
        format!("https://github.com/desktop/dugite-native/releases/download/{DUGITE_TAG}/{asset}");

    let tmp_dir = temp_dir_in(bin_dir, "git")?;
    let archive = tmp_dir.join("dugite.tar.gz");
    download_to(client, &url, &archive).await?;

    tokio::fs::create_dir_all(&git_dir)
        .await
        .map_err(|err| format!("mkdir {}: {err}", git_dir.display()))?;

    // dugite-native releases unpack to a `git/` subdirectory; strip it via --strip-components=1
    // so ~/.orgii/bin/git/bin/git resolves correctly.
    run_tar_extract_strip(&archive, &git_dir, 1)?;

    info!(
        "[sidecar_setup] installed bundled git → {}",
        git_exec.display()
    );
    Ok(())
}

fn dugite_asset(os: &str, arch: &str) -> Result<String, String> {
    let ver = DUGITE_ASSET_VERSION;
    let asset = match (os, arch) {
        ("macos", "aarch64") => format!("dugite-native-{ver}-macOS-arm64.tar.gz"),
        ("macos", "x86_64") => format!("dugite-native-{ver}-macOS-x64.tar.gz"),
        ("linux", "x86_64") => format!("dugite-native-{ver}-ubuntu-x64.tar.gz"),
        ("windows", "x86_64") => format!("dugite-native-{ver}-windows-x64.tar.gz"),
        _ => return Err(format!("dugite: unsupported platform {os}/{arch}")),
    };
    Ok(asset)
}

fn git_binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "git.exe"
    } else {
        "git"
    }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async fn download_to(client: &reqwest::Client, url: &str, dest: &Path) -> Result<(), String> {
    info!("[sidecar_setup] downloading {url}");

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|err| format!("mkdir {}: {err}", parent.display()))?;
    }

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("GET {url}: {err}"))?
        .error_for_status()
        .map_err(|err| format!("GET {url} HTTP error: {err}"))?;

    let bytes = resp
        .bytes()
        .await
        .map_err(|err| format!("reading body {url}: {err}"))?;

    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|err| format!("create {}: {err}", dest.display()))?;

    file.write_all(&bytes)
        .await
        .map_err(|err| format!("write {}: {err}", dest.display()))?;

    Ok(())
}

/// Extract a .tar.gz archive into `dest_dir` using system `tar`.
fn run_tar_extract(archive: &Path, dest_dir: &Path) -> Result<(), String> {
    let mut command = std::process::Command::new("tar");
    command.arg("-xzf").arg(archive).arg("-C").arg(dest_dir);
    // Suppress the console window on Windows.
    app_platform::hide_console(&mut command);
    let status = command
        .status()
        .map_err(|err| format!("tar failed to start: {err}"))?;

    if !status.success() {
        return Err(format!(
            "tar -xzf {} -C {} exited with {}",
            archive.display(),
            dest_dir.display(),
            status
        ));
    }
    Ok(())
}

/// Extract a .tar.gz archive stripping the first N path components.
fn run_tar_extract_strip(archive: &Path, dest_dir: &Path, strip: u32) -> Result<(), String> {
    let mut command = std::process::Command::new("tar");
    command
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(dest_dir)
        .arg(format!("--strip-components={strip}"));
    // Suppress the console window on Windows.
    app_platform::hide_console(&mut command);
    let status = command
        .status()
        .map_err(|err| format!("tar failed to start: {err}"))?;

    if !status.success() {
        return Err(format!(
            "tar -xzf {} --strip-components={} -C {} exited with {}",
            archive.display(),
            strip,
            dest_dir.display(),
            status
        ));
    }
    Ok(())
}

/// Create a temporary working directory inside `parent`.
fn temp_dir_in(parent: &Path, prefix: &str) -> Result<PathBuf, String> {
    let tmp = parent.join(format!(".tmp-{prefix}-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).map_err(|err| format!("mkdir tmp {}: {err}", tmp.display()))?;
    Ok(tmp)
}

/// Recursively find the first file with `name` under `dir`.
fn find_file_named(dir: &Path, name: &str) -> Option<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, name) {
                return Some(found);
            }
        } else if path.file_name().and_then(|n| n.to_str()) == Some(name) {
            return Some(path);
        }
    }
    None
}

fn set_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta =
            std::fs::metadata(path).map_err(|err| format!("metadata {}: {err}", path.display()))?;
        let mut perms = meta.permissions();
        perms.set_mode(perms.mode() | 0o755);
        std::fs::set_permissions(path, perms)
            .map_err(|err| format!("chmod {}: {err}", path.display()))?;
    }
    Ok(())
}

fn is_real_binary(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    !is_placeholder_bytes(&std::fs::read(path).unwrap_or_default())
}

fn is_placeholder_bytes(bytes: &[u8]) -> bool {
    bytes.starts_with(PLACEHOLDER_MARKER)
}
