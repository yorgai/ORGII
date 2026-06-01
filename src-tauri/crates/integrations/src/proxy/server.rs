//! Local HTTPS MITM proxy server.
//!
//! Per-session proxy: each cloud session gets its own proxy on an OS-assigned
//! ephemeral port. Intercepts HTTPS traffic from Cursor/Kiro/Copilot subprocesses
//! (via `HTTPS_PROXY` env var), swaps API keys with proxy tokens, and forwards
//! requests to the ORGII cloud proxy.
//!
//! Only intercepts specific LLM API domains. All other traffic passes through.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Domains to intercept (LLM API endpoints).
pub const INTERCEPTED_DOMAINS: &[&str] = &[
    "api.anthropic.com",
    "api.openai.com",
    "api.github.com",
    "copilot-proxy.githubusercontent.com",
    // Kiro/Bedrock domains matched by pattern in is_intercepted()
];

/// Check if a domain should be intercepted.
pub fn is_intercepted(domain: &str) -> bool {
    // Exact matches
    if INTERCEPTED_DOMAINS.contains(&domain) {
        return true;
    }
    // Pattern matches for AWS services (Kiro, Bedrock)
    if domain.ends_with(".amazonaws.com")
        && (domain.contains("bedrock-runtime")
            || domain.starts_with("q.")
            || domain.starts_with("cognito-identity."))
    {
        return true;
    }
    // Copilot sub-domains
    if domain.ends_with(".githubcopilot.com") {
        return true;
    }
    false
}

/// Proxy server state.
pub struct ProxyServer {
    /// Port the proxy listens on.
    pub port: u16,
    /// The proxy token to inject into intercepted requests.
    pub proxy_token: String,
    /// The ORGII proxy URL to forward requests to.
    pub proxy_url: String,
    /// Whether the server is running.
    pub running: bool,
}

/// Per-session proxy instances (session_id → ProxyServer).
/// Each cloud session gets its own proxy with its own token/port,
/// so multiple concurrent cloud sessions don't cross-contaminate billing.
pub static PROXY_SERVERS: std::sync::LazyLock<Arc<Mutex<HashMap<String, ProxyServer>>>> =
    std::sync::LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

/// Start a per-session MITM proxy.
///
/// Each cloud session gets its own proxy instance with its own token and port.
/// This prevents billing cross-contamination when multiple cloud sessions run
/// concurrently. The OS assigns an ephemeral port (port 0), so there is zero
/// risk of conflict with other apps on the user's machine.
pub async fn start_session_proxy(
    session_id: &str,
    proxy_token: &str,
    proxy_url: &str,
) -> Result<u16, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    // Ensure CA exists
    super::certificate_authority::ensure_ca()?;

    // Bind to port 0 — the OS picks a free ephemeral port automatically.
    // No hardcoded port range, no scanning, no conflict with other apps.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind proxy for session {}: {}", session_id, e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get assigned port: {}", e))?
        .port();

    tracing::info!(
        "[Proxy] Session {} proxy started on port {}",
        session_id,
        port
    );

    // Store state
    {
        let mut servers = PROXY_SERVERS.lock().await;
        servers.insert(
            session_id.to_string(),
            ProxyServer {
                port,
                proxy_token: proxy_token.to_string(),
                proxy_url: proxy_url.to_string(),
                running: true,
            },
        );
    }

    let sid = session_id.to_string();
    let _token = proxy_token.to_string();
    let _url = proxy_url.to_string();

    // Spawn the proxy accept loop
    tokio::spawn(async move {
        loop {
            let running = {
                let servers = PROXY_SERVERS.lock().await;
                servers.get(&sid).map(|s| s.running).unwrap_or(false)
            };
            if !running {
                break;
            }

            let accept_result =
                tokio::time::timeout(tokio::time::Duration::from_secs(2), listener.accept()).await;

            let (mut stream, _addr) = match accept_result {
                Ok(Ok(conn)) => conn,
                Ok(Err(e)) => {
                    tracing::error!("[Proxy] Accept error (session {}): {}", sid, e);
                    continue;
                }
                Err(_) => continue, // Timeout — loop back to check `running`
            };

            let _token = _token.clone();
            let _url = _url.clone();

            tokio::spawn(async move {
                // Read the initial request to determine if it's CONNECT (HTTPS) or plain HTTP
                let mut buf = vec![0u8; 4096];
                let n = match stream.read(&mut buf).await {
                    Ok(0) => {
                        tracing::warn!("[Proxy] Connection closed immediately (0 bytes)");
                        return;
                    }
                    Ok(n) => n,
                    Err(err) => {
                        tracing::warn!("[Proxy] Connection read error: {}", err);
                        return;
                    }
                };

                let request = String::from_utf8_lossy(&buf[..n]);

                if request.starts_with("CONNECT ") {
                    // HTTPS CONNECT tunnel
                    // Extract domain from "CONNECT domain:port HTTP/1.1"
                    let parts: Vec<&str> = request.split_whitespace().collect();
                    if parts.len() >= 2 {
                        let host_port = parts[1];
                        let domain = host_port.split(':').next().unwrap_or("");

                        tracing::debug!(
                            "[Proxy] CONNECT {} (intercepted={})",
                            host_port,
                            is_intercepted(domain)
                        );

                        if is_intercepted(domain) {
                            // Intercepted domain: respond with 200, then do TLS MITM
                            let response = "HTTP/1.1 200 Connection Established\r\n\r\n";
                            if stream.write_all(response.as_bytes()).await.is_err() {
                                tracing::warn!("[Proxy] Failed to send CONNECT 200 for {}", domain);
                                return;
                            }

                            let domain_owned = domain.to_string();
                            let host_port_owned = host_port.to_string();

                            // TLS MITM: decrypt, modify, re-encrypt
                            // Use AssertUnwindSafe + catch_unwind to detect panics
                            let token_clone = _token.clone();
                            let url_clone = _url.clone();
                            let domain_for_log = domain_owned.clone();
                            let result = std::panic::AssertUnwindSafe(handle_mitm_connection(
                                stream,
                                &domain_owned,
                                &host_port_owned,
                                &token_clone,
                                &url_clone,
                            ));
                            match futures::FutureExt::catch_unwind(result).await {
                                Ok(Ok(())) => {
                                    tracing::debug!(
                                        "[Proxy] MITM for {} completed OK",
                                        domain_for_log
                                    );
                                }
                                Ok(Err(err)) => {
                                    tracing::warn!(
                                        "[Proxy] MITM for {} failed: {}",
                                        domain_for_log,
                                        err
                                    );
                                }
                                Err(panic_info) => {
                                    let msg = if let Some(s) = panic_info.downcast_ref::<String>() {
                                        s.clone()
                                    } else if let Some(s) = panic_info.downcast_ref::<&str>() {
                                        s.to_string()
                                    } else {
                                        format!("{:?}", panic_info)
                                    };
                                    tracing::error!(
                                        "[Proxy] MITM for {} PANICKED: {}",
                                        domain_for_log,
                                        msg
                                    );
                                }
                            }
                        } else {
                            // Non-intercepted: tunnel directly
                            let response = "HTTP/1.1 200 Connection Established\r\n\r\n";
                            if stream.write_all(response.as_bytes()).await.is_err() {
                                return;
                            }

                            // Connect to the target with a timeout
                            let connect_timeout = tokio::time::Duration::from_secs(30);
                            match tokio::time::timeout(
                                connect_timeout,
                                tokio::net::TcpStream::connect(host_port),
                            )
                            .await
                            {
                                Ok(Ok(target)) => {
                                    let (mut client_read, mut client_write) = stream.into_split();
                                    let (mut target_read, mut target_write) = target.into_split();

                                    let c2t = tokio::io::copy(&mut client_read, &mut target_write);
                                    let t2c = tokio::io::copy(&mut target_read, &mut client_write);

                                    tokio::select! {
                                        _ = c2t => {},
                                        _ = t2c => {},
                                    }
                                }
                                Ok(Err(e)) => {
                                    tracing::debug!(
                                        "[Proxy] Failed to connect to {}: {}",
                                        host_port,
                                        e
                                    );
                                }
                                Err(_) => {
                                    tracing::debug!(
                                        "[Proxy] Connection to {} timed out",
                                        host_port
                                    );
                                }
                            }
                        }
                    }
                }
                // Plain HTTP requests are not expected (HTTPS_PROXY uses CONNECT)
            });
        }
        tracing::info!("[Proxy] MITM proxy stopped");
    });

    Ok(port)
}

/// Stop a per-session MITM proxy.
///
/// Sets the running flag to false. The accept loop checks this flag
/// on each iteration and will exit within a few seconds.
pub async fn stop_session_proxy(session_id: &str) {
    let mut servers = PROXY_SERVERS.lock().await;
    if let Some(srv) = servers.get_mut(session_id) {
        srv.running = false;
        tracing::info!("[Proxy] Stopping MITM proxy for session {}...", session_id);
    }
    servers.remove(session_id);
    tracing::info!("[Proxy] Session {} proxy removed", session_id);
}

/// Stop ALL per-session proxies (e.g., on app shutdown).
pub async fn stop_all_proxies() {
    let mut servers = PROXY_SERVERS.lock().await;
    for (sid, srv) in servers.iter_mut() {
        srv.running = false;
        tracing::info!("[Proxy] Stopping proxy for session {}", sid);
    }
    servers.clear();
    tracing::info!("[Proxy] All proxies stopped");
}

/// Get the HTTPS_PROXY URL for a specific session.
pub async fn get_session_proxy_url(session_id: &str) -> Option<String> {
    let servers = PROXY_SERVERS.lock().await;
    servers
        .get(session_id)
        .map(|s| format!("http://127.0.0.1:{}", s.port))
}

/// Get the SSL_CERT_FILE path for subprocess env vars.
pub fn get_ssl_cert_file() -> String {
    super::certificate_authority::ca_cert_path()
        .to_string_lossy()
        .to_string()
}

/// Build MITM env vars for a specific session.
///
/// Returns None if the session has no proxy running.
pub async fn get_session_mitm_env_vars(
    session_id: &str,
) -> Option<std::collections::HashMap<String, String>> {
    use core_types::proxy_env;

    let proxy_url = get_session_proxy_url(session_id).await?;
    let cert_file = get_ssl_cert_file();
    let mut env = std::collections::HashMap::new();
    env.insert(proxy_env::HTTPS_PROXY.to_string(), proxy_url.clone());
    env.insert(proxy_env::SSL_CERT_FILE.to_string(), cert_file.clone());
    env.insert(proxy_env::HTTPS_PROXY_LOWER.to_string(), proxy_url);
    env.insert(proxy_env::NODE_EXTRA_CA_CERTS.to_string(), cert_file);
    Some(env)
}

/// Handle a MITM-intercepted TLS connection.
///
/// 1. Generate a cert for the domain (signed by our CA)
/// 2. Perform TLS handshake with the client
/// 3. Read the decrypted HTTP request
/// 4. Swap API key with proxy token + rewrite Host to ORGII proxy
/// 5. Forward to ORGII proxy URL
/// 6. Stream response back to the client (supports chunked transfer / SSE)
async fn handle_mitm_connection(
    stream: tokio::net::TcpStream,
    domain: &str,
    _host_port: &str,
    proxy_token: &str,
    proxy_url: &str,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    tracing::debug!("[Proxy] handle_mitm_connection ENTERED for {}", domain);

    // Load CA cert and key
    let (ca_cert_pem, ca_key_pem) =
        super::certificate_authority::load_ca().map_err(|e| format!("Failed to load CA: {}", e))?;

    // Generate cert for this domain
    let (domain_cert_pem, domain_key_pem) =
        super::certificate_authority::generate_domain_cert(domain, &ca_cert_pem, &ca_key_pem)
            .map_err(|e| format!("Failed to generate domain cert: {}", e))?;

    // Build rustls server config with the domain cert
    let certs = rustls_pemfile::certs(&mut domain_cert_pem.as_bytes())
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();
    let key = rustls_pemfile::private_key(&mut domain_key_pem.as_bytes())
        .map_err(|e| format!("Failed to parse domain key: {}", e))?
        .ok_or("No private key found")?;

    let provider = std::sync::Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
    let server_config = tokio_rustls::rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("Failed to set protocol versions: {}", e))?
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| format!("Failed to build TLS config: {}", e))?;

    let tls_acceptor = tokio_rustls::TlsAcceptor::from(std::sync::Arc::new(server_config));

    // TLS handshake with the client (with timeout to detect hung handshakes)
    let tls_result = tokio::time::timeout(
        tokio::time::Duration::from_secs(10),
        tls_acceptor.accept(stream),
    )
    .await;
    let mut tls_stream = match tls_result {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return Err(format!("TLS handshake failed for {}: {}", domain, e));
        }
        Err(_) => {
            return Err(format!("TLS handshake timed out (10s) for {}", domain));
        }
    };
    tracing::debug!("[Proxy] TLS handshake succeeded for {}", domain);

    // Loop to support HTTP keep-alive: handle multiple requests on the same TLS connection.
    // kiro-cli reuses connections, so after the first API response the client sends the next
    // request on the same tunnel. Without this loop the MITM would drop the connection and
    // kiro-cli would get a reset, causing "Agent error" on tool-use follow-ups.
    let mut request_num = 0u32;
    loop {
        request_num += 1;

        // Read the full HTTP request from the client.
        let request_bytes = {
            let mut buf = Vec::with_capacity(8192);
            let mut header_len = 0usize;

            let mut tmp = vec![0u8; 8192];
            // Use a timeout for subsequent requests so we don't hang forever
            // waiting for a keep-alive request that may never come.
            let read_timeout = if request_num == 1 {
                tokio::time::Duration::from_secs(60)
            } else {
                tokio::time::Duration::from_secs(120)
            };
            loop {
                let read_result =
                    tokio::time::timeout(read_timeout, tls_stream.read(&mut tmp)).await;
                let n = match read_result {
                    Ok(Ok(0)) => {
                        break;
                    } // EOF
                    Ok(Ok(n)) => n,
                    Ok(Err(e)) => {
                        if request_num > 1 {
                            tracing::debug!(
                                "[Proxy] Keep-alive read error (request #{}) for {}: {}",
                                request_num,
                                domain,
                                e
                            );
                            return Ok(());
                        }
                        return Err(format!("Failed to read request headers: {}", e));
                    }
                    Err(_) => {
                        tracing::debug!(
                            "[Proxy] Keep-alive timeout (request #{}) for {}",
                            request_num,
                            domain
                        );
                        return Ok(());
                    }
                };
                buf.extend_from_slice(&tmp[..n]);

                if let Some(pos) = find_header_end(&buf) {
                    header_len = pos + 4;
                    break;
                }
                if buf.len() > 1024 * 1024 {
                    return Err("Request headers too large (>1MB)".to_string());
                }
            }

            if header_len == 0 && buf.is_empty() {
                if request_num > 1 {
                    tracing::debug!(
                        "[Proxy] Client closed keep-alive connection after {} requests for {}",
                        request_num - 1,
                        domain
                    );
                    return Ok(());
                }
                tracing::warn!(
                    "[Proxy] Client disconnected before sending any data for {}",
                    domain
                );
                return Ok(());
            }
            if header_len == 0 {
                tracing::warn!(
                    "[Proxy] Headers incomplete ({} bytes received, no \\r\\n\\r\\n) for {}",
                    buf.len(),
                    domain
                );
            }

            let headers_str = String::from_utf8_lossy(&buf[..header_len]);
            let content_length = parse_content_length(&headers_str);
            let body_received = buf.len() - header_len;
            let body_remaining = content_length.saturating_sub(body_received);

            if body_remaining > 0 {
                if content_length > 50 * 1024 * 1024 {
                    return Err("Request body too large (>50MB)".to_string());
                }
                buf.reserve(body_remaining);
                let mut remaining = body_remaining;
                while remaining > 0 {
                    let to_read = remaining.min(65536);
                    let mut chunk = vec![0u8; to_read];
                    let n = tls_stream
                        .read(&mut chunk)
                        .await
                        .map_err(|e| format!("Failed to read request body: {}", e))?;
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    remaining -= n;
                }
            }

            buf
        };

        // Log the first line of the request
        {
            let first_line = String::from_utf8_lossy(&request_bytes)
                .lines()
                .next()
                .unwrap_or("(empty)")
                .to_string();
            tracing::debug!(
                "[Proxy] MITM request #{} for {}: {}",
                request_num,
                domain,
                first_line
            );
        }

        // Parse HTTP request and swap credentials
        let modified_request = rewrite_request(&request_bytes, domain, proxy_token, proxy_url)?;

        // Parse ORGII proxy URL for outbound connection
        let proxy_parsed =
            url::Url::parse(proxy_url).map_err(|err| format!("Invalid proxy URL: {}", err))?;
        let proxy_host = proxy_parsed.host_str().ok_or("No host in proxy URL")?;
        let proxy_port = proxy_parsed.port_or_known_default().unwrap_or(443);
        let proxy_addr = format!("{}:{}", proxy_host, proxy_port);
        let use_tls = proxy_parsed.scheme() == "https";

        // Connect to ORGII proxy with timeout (new connection per request since upstream doesn't keep-alive)
        let connect_timeout = tokio::time::Duration::from_secs(30);
        let target =
            tokio::time::timeout(connect_timeout, tokio::net::TcpStream::connect(&proxy_addr))
                .await
                .map_err(|_| format!("Connection to proxy {} timed out (30s)", proxy_addr))?
                .map_err(|e| format!("Failed to connect to proxy {}: {}", proxy_addr, e))?;

        if use_tls {
            let mut root_store = tokio_rustls::rustls::RootCertStore::empty();
            root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

            let client_provider =
                std::sync::Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
            let connector =
                tokio_rustls::rustls::ClientConfig::builder_with_provider(client_provider)
                    .with_safe_default_protocol_versions()
                    .map_err(|e| format!("Failed to set client protocol versions: {}", e))?
                    .with_root_certificates(root_store)
                    .with_no_client_auth();

            let server_name =
                tokio_rustls::rustls::pki_types::ServerName::try_from(proxy_host.to_string())
                    .map_err(|e| format!("Invalid server name: {}", e))?;

            let tls_connector = tokio_rustls::TlsConnector::from(std::sync::Arc::new(connector));
            let mut target_tls = tls_connector
                .connect(server_name, target)
                .await
                .map_err(|e| format!("TLS to proxy failed: {}", e))?;

            target_tls
                .write_all(&modified_request)
                .await
                .map_err(|e| format!("Failed to write to proxy: {}", e))?;

            stream_response(&mut target_tls, &mut tls_stream, domain).await?;
        } else {
            let mut target = target;

            target
                .write_all(&modified_request)
                .await
                .map_err(|e| format!("Failed to write to proxy: {}", e))?;

            stream_response(&mut target, &mut tls_stream, domain).await?;
        }

        tracing::debug!(
            "[Proxy] MITM request #{} completed for {}",
            request_num,
            domain
        );
        // Loop back to read the next request on this keep-alive connection
    }
}

/// Rewrite an HTTP request for forwarding to the ORGII proxy.
///
/// - Updates Host header to point to the proxy
/// - Adds X-Original-Host so the proxy knows the real destination
/// - For Authorization / X-Api-Key: ONLY replaces the value if the current
///   token matches our proxy token (or if no auth is present, adds the proxy
///   token). This is critical for Copilot, where the CLI sends our proxy token
///   for auth first, but later sends a GitHub-issued copilot access token
///   for LLM calls. Blindly replacing all tokens would break the second step.
fn rewrite_request(
    request_bytes: &[u8],
    original_domain: &str,
    proxy_token: &str,
    proxy_url: &str,
) -> Result<Vec<u8>, String> {
    // Split headers from body using raw byte search (not lossy string positions,
    // which can be misaligned if non-UTF8 bytes exist before the delimiter).
    let (headers_part, body) = match find_header_end(request_bytes) {
        Some(pos) => (&request_bytes[..pos], &request_bytes[pos..]),
        None => (request_bytes, &[] as &[u8]),
    };

    let headers_str = String::from_utf8_lossy(headers_part);
    let mut lines: Vec<String> = headers_str.lines().map(|l| l.to_string()).collect();

    // Parse proxy URL for Host header
    let proxy_host = url::Url::parse(proxy_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| "localhost".to_string());

    let mut found_auth = false;
    let mut found_host = false;

    for line in &mut lines {
        let lower = line.to_lowercase();

        // Handle Authorization header
        if lower.starts_with("authorization:") {
            found_auth = true;
            // Extract the current token value
            let current_token = extract_bearer_token(line);
            if should_replace_token(&current_token, proxy_token) {
                // Token matches our proxy token (or is the proxy token itself)
                // — replace to ensure consistent Bearer format
                *line = format!("Authorization: Bearer {}", proxy_token);
            }
            // Otherwise: non-proxy token (e.g., copilot access token from GitHub)
            // — leave it unchanged so the forward proxy passes it through
        }
        // Anthropic uses x-api-key instead of Authorization
        else if lower.starts_with("x-api-key:") {
            found_auth = true;
            let current_value = line.split_once(':').map(|(_, v)| v.trim()).unwrap_or("");
            if should_replace_token(&Some(current_value.to_string()), proxy_token) {
                *line = format!("X-Api-Key: {}", proxy_token);
            }
        }
        // Update Host header to proxy
        else if lower.starts_with("host:") {
            *line = format!("Host: {}", proxy_host);
            found_host = true;
        }
    }

    // Add Authorization if not present at all
    if !found_auth {
        lines.insert(1, format!("Authorization: Bearer {}", proxy_token));
    }

    // Add Host if not present
    if !found_host {
        lines.insert(1, format!("Host: {}", proxy_host));
    }

    // Add X-Original-Host so the ORGII proxy knows which provider to route to
    lines.insert(1, format!("X-Original-Host: {}", original_domain));

    // Reassemble
    let mut result = lines.join("\r\n").into_bytes();
    result.extend_from_slice(body);

    Ok(result)
}

/// Extract the bearer/token value from an Authorization header line.
///
/// Handles: "Authorization: Bearer <token>", "Authorization: token <token>",
/// and bare "Authorization: <token>".
fn extract_bearer_token(header_line: &str) -> Option<String> {
    let value = header_line.split_once(':').map(|(_, v)| v.trim())?;
    if let Some(token) = value.strip_prefix("Bearer ") {
        Some(token.to_string())
    } else if let Some(token) = value.strip_prefix("token ") {
        Some(token.to_string())
    } else if !value.is_empty() {
        Some(value.to_string())
    } else {
        None
    }
}

/// Decide whether to replace the current token with our proxy token.
///
/// Returns true if:
/// - The current token IS our proxy token (no-op replacement, ensures format)
/// - The current token is empty/missing (add our token)
///
/// Returns false if the current token is something else entirely
/// (e.g., a copilot access token from GitHub) — we must NOT replace it.
fn should_replace_token(current_token: &Option<String>, proxy_token: &str) -> bool {
    match current_token {
        None => true,                                         // No token — add ours
        Some(token) if token == proxy_token => true,          // Already ours — keep
        Some(token) if token.starts_with("aoaAAAAA") => true, // Fake AWS token wrapping our proxy token (Kiro)
        Some(_) => false,                                     // Different token — don't replace
    }
}

/// Stream response from upstream to client.
///
/// Reads in chunks and writes immediately, supporting:
/// - Chunked Transfer-Encoding (SSE streams from LLM APIs)
/// - Content-Length responses (JSON completions)
/// - Connection close (fallback)
///
/// `domain` is used for logging the HTTP response status line.
async fn stream_response<R, W>(reader: &mut R, writer: &mut W, domain: &str) -> Result<(), String>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin,
{
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = vec![0u8; 32768]; // 32KB chunks for streaming
    let mut first_chunk = true;

    loop {
        match reader.read(&mut buf).await {
            Ok(0) => break, // EOF — upstream closed
            Ok(n) => {
                // Log the HTTP status line from the first chunk of the response
                if first_chunk {
                    first_chunk = false;
                    let snippet = String::from_utf8_lossy(&buf[..n.min(512)]);
                    let status_line = snippet.lines().next().unwrap_or("(empty)");
                    // For non-200 responses, log more context for debugging
                    if !status_line.contains(" 200 ") {
                        let preview = String::from_utf8_lossy(&buf[..n.min(1024)]);
                        tracing::warn!(
                            "[Proxy] MITM non-200 response from {} ({} bytes): {}",
                            domain,
                            n,
                            preview.replace('\n', "\\n").replace('\r', ""),
                        );
                    }
                }

                if let Err(e) = writer.write_all(&buf[..n]).await {
                    // Client disconnected (normal for SSE when client cancels)
                    tracing::debug!("[Proxy] Client write error (likely disconnect): {}", e);
                    break;
                }
                // Flush immediately for SSE streaming
                if let Err(e) = writer.flush().await {
                    tracing::debug!("[Proxy] Client flush error: {}", e);
                    break;
                }
            }
            Err(e) => {
                tracing::debug!("[Proxy] Upstream read error: {}", e);
                break;
            }
        }
    }

    Ok(())
}

/// Find the position of the end-of-headers marker (\r\n\r\n) in raw bytes.
fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Parse Content-Length from raw HTTP headers string.
fn parse_content_length(headers: &str) -> usize {
    for line in headers.lines() {
        if line.to_lowercase().starts_with("content-length:") {
            if let Some(val) = line.split(':').nth(1) {
                return val.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }
    0
}

#[cfg(test)]
#[path = "tests/server_tests.rs"]
mod tests;
