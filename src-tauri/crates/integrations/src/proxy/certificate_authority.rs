//! Root CA certificate generation and storage.
//!
//! Generates a self-signed root CA certificate on first use and stores it
//! in `~/.orgii/proxy/`. This CA is used to sign per-domain certificates
//! for the MITM proxy.

use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, KeyPair};
use std::fs;
use std::path::PathBuf;

/// Mutex-guarded flag to ensure only one thread generates the CA at a time.
/// Unlike `Once`, this can re-run if the CA files are deleted after initial generation.
static CA_GENERATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Get the proxy certificate directory (`~/.orgii/proxy/`).
///
/// Panics if the home directory cannot be determined (should never happen
/// on macOS, Linux, or Windows). We panic instead of falling back to `"."`
/// because writing CA keys to the current working directory (which could be
/// the app bundle on macOS) would be a security issue.
pub fn proxy_dir() -> PathBuf {
    let dir = app_paths::proxy_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        tracing::error!("[Proxy] Failed to create proxy dir {:?}: {}", dir, err);
    }
    dir
}

/// Get the path to the CA certificate PEM file.
pub fn ca_cert_path() -> PathBuf {
    proxy_dir().join("ca.pem")
}

/// Get the path to the CA private key PEM file.
pub fn ca_key_path() -> PathBuf {
    proxy_dir().join("ca-key.pem")
}

/// Check if the CA certificate already exists.
pub fn ca_exists() -> bool {
    ca_cert_path().exists() && ca_key_path().exists()
}

/// Generate a new root CA certificate and key.
///
/// The CA is valid for 10 years and can sign other certificates.
/// Stored as PEM files in `~/.orgii/proxy/`.
pub fn generate_ca() -> Result<(String, String), String> {
    let key_pair =
        KeyPair::generate().map_err(|e| format!("Failed to generate key pair: {}", e))?;

    let mut params = CertificateParams::default();
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params
        .distinguished_name
        .push(DnType::CommonName, "ORGII Proxy CA");
    params
        .distinguished_name
        .push(DnType::OrganizationName, "ORGII");

    // 10-year validity
    let now = time::OffsetDateTime::now_utc();
    params.not_before = now;
    params.not_after = now + time::Duration::days(3650);

    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| format!("Failed to generate CA certificate: {}", e))?;

    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();

    // Write atomically: write to temp files, then rename.
    // This prevents half-written files if the process is killed mid-write.
    let cert_path = ca_cert_path();
    let key_path = ca_key_path();
    let cert_tmp = cert_path.with_extension("pem.tmp");
    let key_tmp = key_path.with_extension("pem.tmp");

    fs::write(&key_tmp, &key_pem).map_err(|e| format!("Failed to write CA key temp: {}", e))?;

    // Restrict key file permissions (cross-platform) — do this before rename so
    // the key is never world-readable
    app_paths::set_sensitive_file_permissions(&key_tmp)
        .map_err(|e| format!("Failed to set CA key permissions: {}", e))?;

    fs::write(&cert_tmp, &cert_pem).map_err(|e| format!("Failed to write CA cert temp: {}", e))?;

    // Atomic rename (on same filesystem)
    fs::rename(&key_tmp, &key_path).map_err(|e| format!("Failed to rename CA key: {}", e))?;
    fs::rename(&cert_tmp, &cert_path).map_err(|e| format!("Failed to rename CA cert: {}", e))?;

    Ok((cert_pem, key_pem))
}

/// Load existing CA certificate and key from disk.
pub fn load_ca() -> Result<(String, String), String> {
    let cert_pem =
        fs::read_to_string(ca_cert_path()).map_err(|e| format!("Failed to read CA cert: {}", e))?;
    let key_pem =
        fs::read_to_string(ca_key_path()).map_err(|e| format!("Failed to read CA key: {}", e))?;
    Ok((cert_pem, key_pem))
}

/// Ensure the CA exists. Generate if it doesn't.
///
/// Thread-safe: uses a Mutex so only one thread generates the CA at a time.
/// Unlike the previous `Once`-based approach, this correctly handles the case
/// where CA files are deleted after initial generation (e.g. user ran
/// `rm ~/.orgii/proxy/ca*`) — it will regenerate instead of failing.
pub fn ensure_ca() -> Result<(String, String), String> {
    // Fast path: CA already exists on disk
    if ca_exists() {
        return load_ca();
    }

    // Slow path: acquire lock and generate (only one thread at a time)
    let _guard = CA_GENERATE_LOCK
        .lock()
        .map_err(|e| format!("CA lock poisoned: {}", e))?;

    // Double-check after acquiring lock (another thread may have generated it)
    if ca_exists() {
        return load_ca();
    }

    tracing::info!("[Proxy] Generating new root CA certificate...");
    generate_ca()
}

/// Generate a certificate signed by our CA for a specific domain.
pub fn generate_domain_cert(
    domain: &str,
    ca_cert_pem: &str,
    ca_key_pem: &str,
) -> Result<(String, String), String> {
    // Parse CA cert and key
    let ca_key =
        KeyPair::from_pem(ca_key_pem).map_err(|e| format!("Failed to parse CA key: {}", e))?;

    let ca_params = CertificateParams::from_ca_cert_pem(ca_cert_pem)
        .map_err(|e| format!("Failed to parse CA cert: {}", e))?;

    let ca_cert = ca_params
        .self_signed(&ca_key)
        .map_err(|e| format!("Failed to reconstruct CA cert: {}", e))?;

    // Generate domain key
    let domain_key =
        KeyPair::generate().map_err(|e| format!("Failed to generate domain key: {}", e))?;

    // Build domain cert params
    let mut params = CertificateParams::default();
    params.distinguished_name.push(DnType::CommonName, domain);
    params.subject_alt_names = vec![rcgen::SanType::DnsName(
        domain
            .try_into()
            .map_err(|e| format!("Invalid domain: {}", e))?,
    )];

    // 1-year validity
    let now = time::OffsetDateTime::now_utc();
    params.not_before = now;
    params.not_after = now + time::Duration::days(365);

    let domain_cert = params
        .signed_by(&domain_key, &ca_cert, &ca_key)
        .map_err(|e| format!("Failed to sign domain cert: {}", e))?;

    Ok((domain_cert.pem(), domain_key.serialize_pem()))
}
