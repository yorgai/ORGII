//! Workspace-level dependency invariants.
//!
//! These tests parse `Cargo.lock` and assert that specific crates are
//! NOT present in the resolved dependency graph. They exist to guard
//! against silent regressions from Cargo's feature unification: a
//! single new dependency (or a single forgotten `default-features =
//! false`) can drag the whole OpenSSL / native-tls / libssh2 chain
//! back into the build, undoing the deliberate cleanup that retired
//! it (~1–2 GB of vendored OpenSSL artifacts and a 30–60 s C compile
//! step on every clean build).
//!
//! If one of these tests fails, do NOT add an exception — the failure
//! is telling you that something pulled the banned crate back in.
//! Inspect with:
//!
//! ```sh
//! cargo tree -p org2 -i <banned-crate> --target all
//! cargo tree -p org2 -i <banned-crate> --target all --edges=features
//! ```
//!
//! …and fix the new dep at the source (either replace it, or make sure
//! it's added with `default-features = false` plus rustls-tls features).
//!
//! See `docs/rust-backend/architecture/rust-backend-restructure
//! --0211.md` and the commit retiring native-tls / vendored OpenSSL
//! for the broader context.

use std::path::PathBuf;

/// Crates that MUST NOT appear in the workspace lockfile.
///
/// Each entry is `(crate_name, why)`. When you change this list, also
/// update the comment block at the top of this file and the
/// corresponding rationale in `src-tauri/Cargo.toml`.
///
/// Crates we deliberately do NOT ban (and why):
///
/// - `schannel` is the Windows-side bridge used by `rustls-native-certs`
///   to load the system CA store. We *want* this for rustls; it is NOT
///   a TLS stack.
/// - `security-framework` plays the same role on macOS, pulled in by
///   `rustls-native-certs` to read the Keychain trust store. Also NOT a
///   TLS stack.
/// - `core-foundation` is a transitive of `security-framework`.
/// - `tokio-rustls`, `hyper-rustls`, and `webpki-roots` are required,
///   not banned. The positive sentinel in `lockfile_is_parseable`
///   confirms they are present.
///
/// The rule of thumb: if a crate exists *only* to provide native TLS
/// (TLS handshakes, X.509 cert chain verification, AEAD), ban it. If
/// it exists to *bridge* rustls to the OS for cert/key access, keep it.
const BANNED_CRATES: &[(&str, &str)] = &[
    // OpenSSL family — vendored OpenSSL builds ~2k C files (~1–2 GB
    // of artifacts) on every clean build. We use rustls everywhere.
    (
        "openssl-sys",
        "rustls only — pulls vendored OpenSSL C build",
    ),
    (
        "openssl-src",
        "vendored OpenSSL source tarball + perl Configure",
    ),
    ("openssl", "rustls only — high-level OpenSSL wrapper"),
    // native-tls family — same TLS backend twice is pure waste; rustls
    // is the chosen one (see `reqwest`/`tokio-tungstenite` lines in
    // `src-tauri/Cargo.toml`).
    ("native-tls", "rustls only"),
    ("native-tls-crate", "alias for native-tls"),
    ("hyper-tls", "reqwest's native-tls glue; we use rustls"),
    ("tokio-native-tls", "ws via native-tls; we use rustls"),
    // SSH transport for libgit2; we shell out to `git` for network ops
    // (see `integrations::github::commands::github_clone_repo`) so the
    // in-process SSH client is dead weight.
    ("libssh2-sys", "git2 network ops are subprocess; SSH unused"),
    // hf-hub `default = ["online"]` silently drags in `ureq` +
    // `native-tls`. Any future user MUST set `default-features = false`
    // and verify the OpenSSL chain stays out.
    ("hf-hub", "default `online` feature pulls native-tls + ureq"),
    // ureq is a second HTTP client that hf-hub used to drag in; we
    // already have reqwest. No code in the workspace should be reaching
    // for ureq directly.
    ("ureq", "second HTTP client; reqwest is the canonical one"),
    // Candle / tokenizers / safetensors — declared but not imported in
    // the original workspace split. Removing them dropped the four
    // candle-* git source builds. If a future feature genuinely needs
    // them, restore with caution and audit feature flags.
    (
        "candle-core",
        "no longer imported; only llama.cpp path remains",
    ),
    ("candle-nn", "no longer imported"),
    ("candle-transformers", "no longer imported"),
    ("candle-metal-kernels", "no longer imported"),
    ("safetensors", "no longer imported"),
    ("tokenizers", "no longer imported"),
];

fn lockfile_path() -> PathBuf {
    // CARGO_MANIFEST_DIR is set by cargo for tests and points at the
    // crate's manifest dir, i.e. `src-tauri/`. Cargo.lock lives at
    // the workspace root, which is the same dir for this workspace.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.lock")
}

fn lockfile_contents() -> String {
    let path = lockfile_path();
    std::fs::read_to_string(&path).unwrap_or_else(|err| {
        panic!(
            "could not read Cargo.lock at {}: {}\n\
             dependency_invariants tests must run from the workspace root",
            path.display(),
            err
        )
    })
}

/// Parse the `name = "..."` lines from Cargo.lock into a list of crate
/// names. Cargo's lockfile format is stable enough that a regex is
/// overkill, but we still require a preceding `[[package]]` header on
/// the previous non-blank line — otherwise a future Cargo schema that
/// puts `name = "..."` inside a `dependencies` array (or a `[patch]`
/// block) would inflate the parse and produce false positives. The
/// shape we accept is exactly:
///
/// ```text
/// [[package]]
/// name = "<crate>"
/// version = "<v>"
/// …
/// ```
///
/// (cargo always emits `name = ...` immediately after `[[package]]`
/// at column 0, with no leading whitespace.)
fn crate_names_in_lockfile(lock: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut prev_was_package_header = false;
    for line in lock.lines() {
        if line == "[[package]]" {
            prev_was_package_header = true;
            continue;
        }
        if prev_was_package_header {
            // Only the line *immediately* following `[[package]]`
            // counts. Everything else is rejected.
            if let Some(rest) = line.strip_prefix("name = \"") {
                if let Some(end) = rest.find('"') {
                    out.push(rest[..end].to_string());
                }
            }
            prev_was_package_header = false;
        }
    }
    out
}

#[test]
fn no_banned_crates_in_lockfile() {
    let lock = lockfile_contents();
    let names = crate_names_in_lockfile(&lock);

    let mut violations: Vec<String> = Vec::new();
    for (banned, reason) in BANNED_CRATES {
        if names.iter().any(|n| n == banned) {
            violations.push(format!(
                "  - `{}` reappeared (reason it should be banned: {})",
                banned, reason
            ));
        }
    }

    assert!(
        violations.is_empty(),
        "Cargo.lock contains crates that were deliberately retired:\n{}\n\n\
         Inspect the regression with:\n\
         \n  cargo tree -p org2 -i <crate> --target all --edges=features\n\
         \n\
         Then either remove the new dep that pulled it in, or — if the new\n\
         dep is essential — add `default-features = false` plus rustls-tls\n\
         features so the banned chain stays out. See the comment in\n\
         `src-tauri/tests/dependency_invariants.rs` for the full rationale.",
        violations.join("\n")
    );
}

#[test]
fn banned_list_has_no_typos() {
    // Cheap sanity check: every banned-crate entry must look like a
    // plausible crate name (lowercase + dashes/digits only). Catches
    // a contributor accidentally typing `Native-TLS` or
    // `openssl_sys`.
    for (name, _) in BANNED_CRATES {
        assert!(
            !name.is_empty()
                && name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
            "BANNED_CRATES entry `{}` is not a valid crate name (lowercase + digits + dashes)",
            name
        );
    }
}

#[test]
fn lockfile_is_parseable() {
    // Smoke check: Cargo.lock has at least 100 packages. Catches a
    // broken `read_to_string` or a path mistake (CARGO_MANIFEST_DIR
    // pointing at the wrong place).
    let lock = lockfile_contents();
    let names = crate_names_in_lockfile(&lock);
    assert!(
        names.len() > 100,
        "Cargo.lock parsed to {} crates — that's suspiciously few; \
         lockfile path or parser is wrong",
        names.len()
    );

    // Positive sentinels: the rustls crates we *do* depend on must be
    // present. Asserting just `rustls` is too weak — it's the
    // umbrella crate and could be pulled in by a transitive dep that
    // doesn't actually wire TLS through reqwest/tungstenite. The
    // crates below are the concrete glue:
    //
    //   - `tokio-rustls`  — what `reqwest`'s `rustls-tls` feature uses
    //   - `hyper-rustls`  — what `reqwest` uses to plug rustls into hyper
    //   - `webpki-roots`  — Mozilla CA bundle (used by rustls-native-roots)
    //
    // If any of these go missing, the production HTTP client is using
    // a TLS stack we didn't ask for.
    for required in ["rustls", "tokio-rustls", "hyper-rustls", "webpki-roots"] {
        assert!(
            names.iter().any(|n| n == required),
            "expected `{}` in Cargo.lock — rustls glue is broken?",
            required
        );
    }
}
