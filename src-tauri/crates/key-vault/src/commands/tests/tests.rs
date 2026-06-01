use crate::commands::validate::validate_token_format;

#[test]
fn test_format_validation_from_credentials_file() {
    use serde::Deserialize;
    use std::collections::HashMap;
    use std::fs;

    #[derive(Deserialize)]
    struct CredentialsFile {
        credentials: HashMap<String, StoredCredential>,
    }

    #[derive(Deserialize)]
    struct StoredCredential {
        name: String,
        agent_type: String,
        api_key: Option<String>,
    }

    let creds_path = app_paths::keys();

    if !creds_path.exists() {
        println!("Credentials file not found, skipping test");
        return;
    }

    let contents = fs::read_to_string(&creds_path).expect("Failed to read credentials file");
    let creds_file: CredentialsFile =
        serde_json::from_str(&contents).expect("Failed to parse credentials file");

    println!("\n=== Validating credentials from {:?} ===\n", creds_path);

    for (id, cred) in &creds_file.credentials {
        let api_key = cred.api_key.clone().unwrap_or_default();

        if api_key.is_empty() {
            println!(
                "  [{}] {} ({}) - SKIP: No API key",
                id, cred.name, cred.agent_type
            );
            continue;
        }

        let result = validate_token_format(cred.agent_type.clone(), api_key);

        match result {
            Ok((valid, msg)) => {
                let status = if valid { "PASS" } else { "FAIL" };
                println!(
                    "  [{}] {} ({}) - {}: {}",
                    id, cred.name, cred.agent_type, status, msg
                );
            }
            Err(e) => {
                println!(
                    "  [{}] {} ({}) - ERROR: {}",
                    id, cred.name, cred.agent_type, e
                );
            }
        }
    }

    println!("\n=== Format validation complete ===\n");
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_homebrew() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/opt/homebrew/bin/cursor").as_deref(),
        Some("homebrew")
    );
    assert_eq!(
        infer_install_method("/usr/local/Cellar/foo/1.0/bin/foo").as_deref(),
        Some("homebrew")
    );
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_npm() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/projects/app/node_modules/.bin/cursor").as_deref(),
        Some("npm")
    );
    assert_eq!(
        infer_install_method("/Users/x/.nvm/versions/node/v20/bin/cursor").as_deref(),
        Some("npm")
    );
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_cargo() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/Users/x/.cargo/bin/cursor-agent").as_deref(),
        Some("cargo")
    );
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_pip() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/Users/x/.local/pipx/venvs/foo/bin/foo").as_deref(),
        Some("pip")
    );
    assert_eq!(
        infer_install_method("/home/x/Library/Python/3.11/bin/poetry").as_deref(),
        Some("pip")
    );
}

#[cfg(not(windows))]
#[test]
fn test_infer_install_curl() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/usr/local/bin/cursor").as_deref(),
        Some("curl")
    );
}

#[test]
fn test_infer_install_unknown() {
    use crate::commands::registry::infer_install_method;

    assert_eq!(
        infer_install_method("/opt/unique-nonstandard-path/bin/my-tool").as_deref(),
        None
    );
}
