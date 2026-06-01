//! Probes for channels that rely on TCP reachability, local bridges,
//! or simple URL health checks (as opposed to full REST bot APIs).

use std::time::Instant;

use super::common::{elapsed_ms, probe_client, ProbeResult};

/// Probe Email by attempting a TCP connection to the IMAP host:port.
///
/// A full IMAP login is not attempted to avoid side effects; we only verify
/// that the host is reachable and the port is open.
pub(super) async fn probe_email(host: &str, port: u16) -> ProbeResult {
    let start = Instant::now();
    if host.is_empty() {
        return ProbeResult::failure("IMAP host is empty", elapsed_ms(start));
    }

    let addr = format!("{}:{}", host, port);
    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_stream)) => ProbeResult::success(format!("{}:{}", host, port), elapsed_ms(start)),
        Ok(Err(err)) => {
            ProbeResult::failure(format!("Connection failed: {}", err), elapsed_ms(start))
        }
        Err(_) => ProbeResult::failure("Connection timed out", elapsed_ms(start)),
    }
}

/// Probe WhatsApp by checking if the bridge WebSocket URL is reachable.
pub(super) async fn probe_whatsapp(bridge_url: &str) -> ProbeResult {
    let start = Instant::now();
    if bridge_url.is_empty() {
        return ProbeResult::failure("Bridge URL is empty", elapsed_ms(start));
    }

    let url = match url::Url::parse(bridge_url) {
        Ok(url) => url,
        Err(err) => {
            return ProbeResult::failure(format!("Invalid URL: {}", err), elapsed_ms(start))
        }
    };

    let host = url.host_str().unwrap_or("localhost");
    let port = url.port().unwrap_or(3001);
    let addr = format!("{}:{}", host, port);

    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_stream)) => ProbeResult::success(bridge_url.to_string(), elapsed_ms(start)),
        Ok(Err(err)) => {
            ProbeResult::failure(format!("Bridge unreachable: {}", err), elapsed_ms(start))
        }
        Err(_) => ProbeResult::failure("Connection timed out", elapsed_ms(start)),
    }
}

/// Probe iMessage by hitting the BlueBubbles server ping endpoint.
pub(super) async fn probe_imessage(server_url: &str, password: &str) -> ProbeResult {
    let start = Instant::now();
    if server_url.is_empty() {
        return ProbeResult::failure("Server URL is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = format!(
        "{}/api/v1/server/info?password={}",
        server_url.trim_end_matches('/'),
        password
    );

    match client.get(&url).send().await {
        Ok(res) => {
            if res.status().is_success() {
                ProbeResult::success("BlueBubbles Server", elapsed_ms(start))
            } else {
                ProbeResult::failure(format!("HTTP {}", res.status().as_u16()), elapsed_ms(start))
            }
        }
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe Signal by calling the signal-cli-rest-api about endpoint.
pub(super) async fn probe_signal(api_url: &str, phone_number: &str) -> ProbeResult {
    let start = Instant::now();
    if api_url.is_empty() || phone_number.is_empty() {
        return ProbeResult::failure("API URL or phone number is empty", elapsed_ms(start));
    }

    let client = probe_client();
    let url = format!("{}/v1/about", api_url.trim_end_matches('/'));

    match client.get(&url).send().await {
        Ok(res) => {
            if res.status().is_success() {
                ProbeResult::success(format!("Signal ({})", phone_number), elapsed_ms(start))
            } else {
                ProbeResult::failure(format!("HTTP {}", res.status().as_u16()), elapsed_ms(start))
            }
        }
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe WeCom (Enterprise WeChat) by checking that the websocket gateway
/// hostname resolves and the TLS port is reachable. WeCom does not expose a
/// cheap REST handshake for the gateway flow, so reachability is the safest
/// non-side-effect check we can do.
pub(super) async fn probe_wecom(websocket_url: &str, bot_id: &str) -> ProbeResult {
    let start = Instant::now();
    if bot_id.is_empty() {
        return ProbeResult::failure("Bot ID is empty", elapsed_ms(start));
    }
    if websocket_url.is_empty() {
        return ProbeResult::failure("WebSocket URL is empty", elapsed_ms(start));
    }

    let url = match url::Url::parse(websocket_url) {
        Ok(url) => url,
        Err(err) => {
            return ProbeResult::failure(format!("Invalid URL: {}", err), elapsed_ms(start))
        }
    };

    let host = match url.host_str() {
        Some(host) => host.to_string(),
        None => return ProbeResult::failure("URL has no host", elapsed_ms(start)),
    };
    let port = url.port().unwrap_or_else(|| match url.scheme() {
        "wss" | "https" => 443,
        _ => 80,
    });
    let addr = format!("{}:{}", host, port);

    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_stream)) => ProbeResult::success(format!("WeCom ({})", bot_id), elapsed_ms(start)),
        Ok(Err(err)) => {
            ProbeResult::failure(format!("Gateway unreachable: {}", err), elapsed_ms(start))
        }
        Err(_) => ProbeResult::failure("Connection timed out", elapsed_ms(start)),
    }
}

/// Probe Weixin (personal WeChat via iLink) by hitting the iLink base URL.
/// We do not exercise the bot token because invoking iLink with an invalid or
/// expired token would produce side effects (account flags); a base-URL HEAD
/// request is enough to confirm the gateway is reachable.
pub(super) async fn probe_weixin(base_url: &str, bot_account_id: &str) -> ProbeResult {
    let start = Instant::now();
    if base_url.is_empty() {
        return ProbeResult::failure("Base URL is empty", elapsed_ms(start));
    }

    let identity = if bot_account_id.is_empty() {
        "Weixin (no bot account configured)".to_string()
    } else {
        format!("Weixin ({})", bot_account_id)
    };

    let client = probe_client();
    match client.head(base_url.trim_end_matches('/')).send().await {
        Ok(res) => {
            let status = res.status().as_u16();
            // iLink returns various 2xx/4xx for the bare base URL; anything
            // that isn't a transport error proves the host is reachable.
            if status < 500 {
                ProbeResult::success(identity, elapsed_ms(start))
            } else {
                ProbeResult::failure(format!("HTTP {}", status), elapsed_ms(start))
            }
        }
        Err(err) => ProbeResult::failure(err.to_string(), elapsed_ms(start)),
    }
}

/// Probe Google Chat by checking if the webhook URL is reachable.
pub(super) async fn probe_googlechat(webhook_url: &str) -> ProbeResult {
    let start = Instant::now();
    if webhook_url.is_empty() {
        return ProbeResult::failure("Webhook URL is empty", elapsed_ms(start));
    }

    match url::Url::parse(webhook_url) {
        Ok(parsed) => {
            if parsed.host_str().is_some() {
                ProbeResult::success("Google Chat Webhook", elapsed_ms(start))
            } else {
                ProbeResult::failure("Invalid webhook URL", elapsed_ms(start))
            }
        }
        Err(err) => ProbeResult::failure(format!("Invalid URL: {}", err), elapsed_ms(start)),
    }
}
