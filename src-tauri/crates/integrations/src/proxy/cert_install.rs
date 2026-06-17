//! OS-specific certificate installation helpers.
//!
//! Guides the user through installing the ORGII Proxy CA certificate
//! into the system trust store. This is a one-time operation.

use std::process::Command;

use super::certificate_authority;

/// Check if the CA certificate is installed in the system trust store.
pub fn is_ca_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("security")
            .args(["find-certificate", "-c", "ORGII Proxy CA", "-a"])
            .output();
        if let Ok(out) = output {
            return out.status.success() && !out.stdout.is_empty();
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Debian/Ubuntu path
        let ca_path = std::path::Path::new("/usr/local/share/ca-certificates/orgii-proxy-ca.crt");
        // Fedora/RHEL path
        let ca_path_rh =
            std::path::Path::new("/etc/pki/ca-trust/source/anchors/orgii-proxy-ca.crt");
        return ca_path.exists() || ca_path_rh.exists();
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("certutil");
        cmd.args(["-verifystore", "Root", "ORGII Proxy CA"]);
        // Suppress console window on Windows.
        app_platform::hide_console(&mut cmd);
        let output = cmd.output();
        if let Ok(out) = output {
            return out.status.success();
        }
    }

    false
}

/// Install the CA certificate into the system trust store.
///
/// Requires admin/sudo privileges. Returns a user-friendly command
/// if programmatic installation fails.
pub fn install_ca() -> Result<(), String> {
    let cert_path = certificate_authority::ca_cert_path();
    // Convert to owned String to avoid lifetime issues with to_string_lossy
    let cert_path_str = cert_path.to_string_lossy().into_owned();

    if !cert_path.exists() {
        return Err("CA certificate not found. Generate it first.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        // Try programmatic install (requires admin password)
        let output = Command::new("security")
            .args([
                "add-trusted-cert",
                "-d", // add to admin cert store
                "-r",
                "trustRoot",
                "-k",
                "/Library/Keychains/System.keychain",
                &cert_path_str,
            ])
            .output();

        match output {
            Ok(out) if out.status.success() => {
                tracing::info!("[Proxy] CA certificate installed to macOS system keychain");
                return Ok(());
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                return Err(format!(
                    "Certificate installation requires admin privileges. Run:\n\
                     sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain {}\n\
                     Error: {}",
                    cert_path_str, stderr.trim()
                ));
            }
            Err(e) => {
                return Err(format!("Failed to run security command: {}", e));
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Detect distro family: Fedora/RHEL vs Debian/Ubuntu
        let is_rhel = std::path::Path::new("/etc/pki/ca-trust").exists();

        let (dest, update_cmd) = if is_rhel {
            (
                "/etc/pki/ca-trust/source/anchors/orgii-proxy-ca.crt",
                "update-ca-trust",
            )
        } else {
            (
                "/usr/local/share/ca-certificates/orgii-proxy-ca.crt",
                "update-ca-certificates",
            )
        };

        let copy_result = Command::new("cp")
            .args([cert_path_str.as_str(), dest])
            .output();

        match copy_result {
            Ok(out) if out.status.success() => {
                let update = Command::new(update_cmd).output();
                if let Ok(u) = update {
                    if u.status.success() {
                        tracing::info!("[Proxy] CA certificate installed to Linux trust store");
                        return Ok(());
                    }
                }
                return Err(format!(
                    "Certificate copied but trust store update failed. Run:\n\
                     sudo {}",
                    update_cmd
                ));
            }
            _ => {
                return Err(format!(
                    "Certificate installation requires root. Run:\n\
                     sudo cp {} {} && sudo {}",
                    cert_path_str, dest, update_cmd
                ));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("certutil");
        cmd.args(["-addstore", "Root", &cert_path_str]);
        // Suppress console window on Windows.
        app_platform::hide_console(&mut cmd);
        let output = cmd.output();

        match output {
            Ok(out) if out.status.success() => {
                tracing::info!("[Proxy] CA certificate installed to Windows trust store");
                return Ok(());
            }
            _ => {
                return Err(format!(
                    "Certificate installation requires admin. Run as Administrator:\n\
                     certutil -addstore Root {}",
                    cert_path_str
                ));
            }
        }
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for certificate installation".to_string())
}

/// Uninstall the CA certificate from the system trust store.
pub fn uninstall_ca() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("security")
            .args(["delete-certificate", "-c", "ORGII Proxy CA", "-t"])
            .output();

        match output {
            Ok(out) if out.status.success() => {
                tracing::info!("[Proxy] CA certificate removed from macOS keychain");
                return Ok(());
            }
            _ => {
                return Err("Failed to remove certificate. Run:\n\
                     security delete-certificate -c \"ORGII Proxy CA\" -t"
                    .to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Remove from both Debian and RHEL paths
        let _ = std::fs::remove_file("/usr/local/share/ca-certificates/orgii-proxy-ca.crt");
        let _ = std::fs::remove_file("/etc/pki/ca-trust/source/anchors/orgii-proxy-ca.crt");

        // Try both update commands — at most one will exist
        let _ = Command::new("update-ca-certificates").output();
        let _ = Command::new("update-ca-trust").output();
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("certutil");
        cmd.args(["-delstore", "Root", "ORGII Proxy CA"]);
        // Suppress console window on Windows.
        app_platform::hide_console(&mut cmd);
        let _ = cmd.output();
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}
