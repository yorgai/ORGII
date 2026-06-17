//! Network Utilities
//!
//! - VPN detection via network interface inspection (utun/tun/tap/wg/ppp).
//! - Public IP + geolocation lookup via ipinfo.io (bypasses webview HTTP cache).

use std::process::Command;
use std::time::Duration;

#[derive(serde::Serialize, Default)]
pub struct VpnStatus {
    pub detected: bool,
    pub interfaces: Vec<VpnInterface>,
}

#[derive(serde::Serialize)]
pub struct VpnInterface {
    pub name: String,
    pub kind: String,
    /// "active" = has IP + traffic, "idle" = exists but no traffic, "down" = no IP assigned
    pub status: String,
}

/// Known VPN interface prefixes and their human-readable types
#[cfg(any(target_os = "macos", target_os = "linux"))]
const VPN_PREFIXES: &[(&str, &str)] = &[
    ("utun", "VPN Tunnel"),
    ("tun", "TUN"),
    ("tap", "TAP"),
    ("wg", "WireGuard"),
    ("ppp", "PPP"),
    ("ipsec", "IPSec"),
    ("gpd", "GlobalProtect"),
    ("tailscale", "Tailscale"),
];

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn classify_interface(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    for &(prefix, kind) in VPN_PREFIXES {
        if lower.starts_with(prefix) {
            return Some(kind);
        }
    }
    None
}

/// Detect VPN by listing network interfaces and checking their status.
/// Runs on a background thread to avoid blocking the main thread.
#[tauri::command]
pub async fn detect_vpn() -> VpnStatus {
    tokio::task::spawn_blocking(|| {
        let interfaces = detect_vpn_interfaces();
        let detected = interfaces.iter().any(|i| i.status == "active");
        VpnStatus {
            detected,
            interfaces,
        }
    })
    .await
    .unwrap_or_default()
}

// ============================================
// macOS
// ============================================

#[cfg(target_os = "macos")]
fn detect_vpn_interfaces() -> Vec<VpnInterface> {
    // `ifconfig -l` lists all interface names
    let list_output = Command::new("ifconfig").arg("-l").output().ok();

    let Some(list_output) = list_output else {
        return vec![];
    };
    if !list_output.status.success() {
        return vec![];
    }

    let names = String::from_utf8_lossy(&list_output.stdout);
    names
        .split_whitespace()
        .filter_map(|name| {
            let kind = classify_interface(name)?;
            let status = get_interface_status_macos(name);
            Some(VpnInterface {
                name: name.to_string(),
                kind: kind.to_string(),
                status,
            })
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn get_interface_status_macos(name: &str) -> String {
    // Run `ifconfig <name>` to get full details
    let output = Command::new("ifconfig").arg(name).output().ok();

    let Some(output) = output else {
        return "down".to_string();
    };
    if !output.status.success() {
        return "down".to_string();
    }

    let text = String::from_utf8_lossy(&output.stdout);

    // Check if interface has UP flag
    let is_up = text
        .lines()
        .any(|line| line.contains("flags=") && line.contains("UP"));
    if !is_up {
        return "down".to_string();
    }

    // Check if it has an inet (IPv4) or inet6 address (not link-local fe80::)
    let has_ip = text.lines().any(|line| {
        let trimmed = line.trim();
        if trimmed.starts_with("inet ") {
            return true;
        }
        if trimmed.starts_with("inet6 ")
            && !trimmed.contains("fe80::")
            && !trimmed.contains("scopeid")
        {
            return true;
        }
        false
    });

    if !has_ip {
        return "down".to_string();
    }

    // Parse TX/RX bytes from `netstat -bI <name>` to determine if traffic is flowing
    let netstat = Command::new("netstat").args(["-bI", name]).output().ok();

    if let Some(ns_output) = netstat {
        if ns_output.status.success() {
            let ns_text = String::from_utf8_lossy(&ns_output.stdout);
            // Data lines (skip header). Look for non-zero bytes in/out columns.
            for line in ns_text.lines().skip(1) {
                let cols: Vec<&str> = line.split_whitespace().collect();
                // netstat -bI format: Name Mtu Network Address Ipkts Ibytes Opkts Obytes ...
                if cols.len() >= 8 && cols[0] == name {
                    let ibytes: u64 = cols[5].parse().unwrap_or(0);
                    let obytes: u64 = cols[7].parse().unwrap_or(0);
                    if ibytes > 0 || obytes > 0 {
                        return "active".to_string();
                    }
                }
            }
        }
    }

    "idle".to_string()
}

// ============================================
// Linux
// ============================================

#[cfg(target_os = "linux")]
fn detect_vpn_interfaces() -> Vec<VpnInterface> {
    let entries = std::fs::read_dir("/sys/class/net").ok();
    let Some(entries) = entries else {
        return vec![];
    };

    entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let kind = classify_interface(&name)?;
            let status = get_interface_status_linux(&name);
            Some(VpnInterface {
                name,
                kind: kind.to_string(),
                status,
            })
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn get_interface_status_linux(name: &str) -> String {
    let base = format!("/sys/class/net/{}", name);

    // Check operstate
    let operstate = std::fs::read_to_string(format!("{}/operstate", base)).unwrap_or_default();
    if operstate.trim() != "up" && operstate.trim() != "unknown" {
        return "down".to_string();
    }

    // Check TX/RX bytes
    let rx: u64 = std::fs::read_to_string(format!("{}/statistics/rx_bytes", base))
        .unwrap_or_default()
        .trim()
        .parse()
        .unwrap_or(0);
    let tx: u64 = std::fs::read_to_string(format!("{}/statistics/tx_bytes", base))
        .unwrap_or_default()
        .trim()
        .parse()
        .unwrap_or(0);

    if rx > 0 || tx > 0 {
        "active".to_string()
    } else {
        "idle".to_string()
    }
}

// ============================================
// Windows
// ============================================

#[cfg(target_os = "windows")]
fn detect_vpn_interfaces() -> Vec<VpnInterface> {
    let mut command = Command::new("netsh");
    command.args(["interface", "show", "interface"]);
    // Don't flash a console window during VPN/interface detection.
    app_platform::hide_console(&mut command);
    let output = command.output().ok();

    let Some(output) = output else { return vec![] };
    if !output.status.success() {
        return vec![];
    }

    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter_map(|line| {
            let lower = line.to_lowercase();
            if !lower.contains("tap")
                && !lower.contains("tun")
                && !lower.contains("wireguard")
                && !lower.contains("wintun")
                && !lower.contains("tailscale")
            {
                return None;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 4 {
                return None;
            }
            let admin_state = parts[0].to_lowercase();
            let connect_state = parts[1].to_lowercase();
            let name = parts[3..].join(" ");
            let kind = if lower.contains("wireguard") || lower.contains("wintun") {
                "WireGuard"
            } else if lower.contains("tailscale") {
                "Tailscale"
            } else if lower.contains("tap") {
                "TAP"
            } else {
                "TUN"
            };
            let status = if admin_state == "enabled" && connect_state == "connected" {
                "active"
            } else if admin_state == "enabled" {
                "idle"
            } else {
                "down"
            };
            Some(VpnInterface {
                name,
                kind: kind.to_string(),
                status: status.to_string(),
            })
        })
        .collect()
}

// ============================================
// Public IP + Geolocation
// ============================================

#[derive(serde::Serialize, Default)]
pub struct GeoInfo {
    pub ip: String,
    pub city: String,
    pub region: String,
    pub country: String,
    pub org: String,
}

/// Fetch public IP and geolocation from ipinfo.io using reqwest.
/// Bypasses webview HTTP cache — always hits the network.
#[tauri::command]
pub async fn fetch_geo_info() -> Result<GeoInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .no_proxy()
        .build()
        .map_err(|err| err.to_string())?;

    let resp = client
        .get("https://ipinfo.io/json?token=")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let data: serde_json::Value = resp.json().await.map_err(|err| err.to_string())?;

    Ok(GeoInfo {
        ip: data["ip"].as_str().unwrap_or_default().to_string(),
        city: data["city"].as_str().unwrap_or_default().to_string(),
        region: data["region"].as_str().unwrap_or_default().to_string(),
        country: data["country"].as_str().unwrap_or_default().to_string(),
        org: data["org"].as_str().unwrap_or_default().to_string(),
    })
}
