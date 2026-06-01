use crate::proxy::server::*;

// ---------------------------------------------------------------------------
// is_intercepted
// ---------------------------------------------------------------------------

#[test]
fn is_intercepted_exact_anthropic() {
    assert!(is_intercepted("api.anthropic.com"));
}

#[test]
fn is_intercepted_exact_openai() {
    assert!(is_intercepted("api.openai.com"));
}

#[test]
fn is_intercepted_exact_github() {
    assert!(is_intercepted("api.github.com"));
}

#[test]
fn is_intercepted_exact_copilot_proxy() {
    assert!(is_intercepted("copilot-proxy.githubusercontent.com"));
}

#[test]
fn is_intercepted_aws_bedrock() {
    assert!(is_intercepted("us-east-1.bedrock-runtime.amazonaws.com"));
}

#[test]
fn is_intercepted_aws_q() {
    assert!(is_intercepted("q.us-east-1.amazonaws.com"));
}

#[test]
fn is_intercepted_aws_cognito() {
    assert!(is_intercepted("cognito-identity.us-east-1.amazonaws.com"));
}

#[test]
fn is_intercepted_aws_s3_not_intercepted() {
    assert!(!is_intercepted("s3.amazonaws.com"));
}

#[test]
fn is_intercepted_copilot_subdomain() {
    assert!(is_intercepted("foo.githubcopilot.com"));
}

#[test]
fn is_intercepted_random_domain() {
    assert!(!is_intercepted("example.com"));
}

#[test]
fn is_intercepted_google() {
    assert!(!is_intercepted("google.com"));
}

#[test]
fn is_intercepted_empty_string() {
    assert!(!is_intercepted(""));
}

// ---------------------------------------------------------------------------
// extract_bearer_token
// ---------------------------------------------------------------------------

#[test]
fn extract_bearer_token_bearer_prefix() {
    assert_eq!(
        extract_bearer_token("Authorization: Bearer abc123"),
        Some("abc123".to_string())
    );
}

#[test]
fn extract_bearer_token_token_prefix() {
    assert_eq!(
        extract_bearer_token("Authorization: token xyz789"),
        Some("xyz789".to_string())
    );
}

#[test]
fn extract_bearer_token_bare_value() {
    assert_eq!(
        extract_bearer_token("Authorization: raw-value"),
        Some("raw-value".to_string())
    );
}

#[test]
fn extract_bearer_token_empty_value_with_space() {
    assert_eq!(extract_bearer_token("Authorization: "), None);
}

#[test]
fn extract_bearer_token_empty_value_no_space() {
    assert_eq!(extract_bearer_token("Authorization:"), None);
}

#[test]
fn extract_bearer_token_different_header_name() {
    // Function doesn't validate the header name — it only splits on ':'
    assert_eq!(
        extract_bearer_token("X-Api-Key: somekey"),
        Some("somekey".to_string())
    );
}

#[test]
fn extract_bearer_token_no_colon() {
    assert_eq!(extract_bearer_token("no-colon-here"), None);
}

// ---------------------------------------------------------------------------
// should_replace_token
// ---------------------------------------------------------------------------

#[test]
fn should_replace_token_none_returns_true() {
    assert!(should_replace_token(&None, "my-proxy-token"));
}

#[test]
fn should_replace_token_matches_proxy_token() {
    assert!(should_replace_token(
        &Some("my-proxy-token".to_string()),
        "my-proxy-token"
    ));
}

#[test]
fn should_replace_token_kiro_fake_aws_token() {
    assert!(should_replace_token(
        &Some("aoaAAAAAblargh".to_string()),
        "my-proxy"
    ));
}

#[test]
fn should_replace_token_foreign_token_not_replaced() {
    assert!(!should_replace_token(
        &Some("copilot-access-token-from-github".to_string()),
        "my-proxy"
    ));
}

#[test]
fn should_replace_token_empty_string_not_replaced() {
    assert!(!should_replace_token(&Some("".to_string()), "my-proxy"));
}

// ---------------------------------------------------------------------------
// find_header_end
// ---------------------------------------------------------------------------

#[test]
fn find_header_end_normal_request() {
    let buf = b"GET / HTTP/1.1\r\nHost: foo\r\n\r\nbody";
    let pos = find_header_end(buf).unwrap();
    assert_eq!(&buf[pos..pos + 4], b"\r\n\r\n");
}

#[test]
fn find_header_end_no_marker() {
    assert_eq!(find_header_end(b"no headers here"), None);
}

#[test]
fn find_header_end_at_start() {
    assert_eq!(find_header_end(b"\r\n\r\n"), Some(0));
}

#[test]
fn find_header_end_empty() {
    assert_eq!(find_header_end(b""), None);
}

// ---------------------------------------------------------------------------
// parse_content_length
// ---------------------------------------------------------------------------

#[test]
fn parse_content_length_normal() {
    assert_eq!(parse_content_length("Content-Length: 42"), 42);
}

#[test]
fn parse_content_length_lowercase() {
    assert_eq!(parse_content_length("content-length: 100"), 100);
}

#[test]
fn parse_content_length_uppercase() {
    assert_eq!(parse_content_length("CONTENT-LENGTH: 0"), 0);
}

#[test]
fn parse_content_length_missing() {
    assert_eq!(parse_content_length("Host: example.com\r\nAccept: */*"), 0);
}

#[test]
fn parse_content_length_invalid_value() {
    assert_eq!(parse_content_length("Content-Length: invalid"), 0);
}

#[test]
fn parse_content_length_among_multiple_headers() {
    let headers = "Host: example.com\r\nContent-Length: 55\r\nAccept: */*";
    assert_eq!(parse_content_length(headers), 55);
}

// ---------------------------------------------------------------------------
// rewrite_request
// ---------------------------------------------------------------------------

#[test]
fn rewrite_adds_original_host_and_updates_host() {
    let request =
        b"GET /v1/chat HTTP/1.1\r\nHost: api.openai.com\r\nAuthorization: Bearer proxy-tok\r\n\r\n";
    let result = rewrite_request(
        request,
        "api.openai.com",
        "proxy-tok",
        "https://proxy.soyd.io",
    )
    .unwrap();
    let text = String::from_utf8_lossy(&result);
    assert!(
        text.contains("Host: proxy.soyd.io"),
        "Host not rewritten: {text}"
    );
    assert!(
        text.contains("X-Original-Host: api.openai.com"),
        "X-Original-Host missing: {text}"
    );
    assert!(
        text.contains("Authorization: Bearer proxy-tok"),
        "Auth header missing: {text}"
    );
}

#[test]
fn rewrite_preserves_foreign_auth_token() {
    let request = b"POST /v1/chat HTTP/1.1\r\nHost: api.openai.com\r\nAuthorization: Bearer copilot-real-token\r\n\r\n";
    let result = rewrite_request(
        request,
        "api.openai.com",
        "proxy-tok",
        "https://proxy.soyd.io",
    )
    .unwrap();
    let text = String::from_utf8_lossy(&result);
    assert!(
        text.contains("Authorization: Bearer copilot-real-token"),
        "Foreign token was replaced: {text}"
    );
}

#[test]
fn rewrite_adds_auth_when_missing() {
    let request = b"GET /v1/models HTTP/1.1\r\nHost: api.openai.com\r\n\r\n";
    let result = rewrite_request(
        request,
        "api.openai.com",
        "proxy-tok",
        "https://proxy.soyd.io",
    )
    .unwrap();
    let text = String::from_utf8_lossy(&result);
    assert!(
        text.contains("Authorization: Bearer proxy-tok"),
        "Auth not added: {text}"
    );
}

#[test]
fn rewrite_handles_x_api_key_with_proxy_token() {
    let request =
        b"POST /v1/messages HTTP/1.1\r\nHost: api.anthropic.com\r\nX-Api-Key: proxy-tok\r\n\r\n";
    let result = rewrite_request(
        request,
        "api.anthropic.com",
        "proxy-tok",
        "https://proxy.soyd.io",
    )
    .unwrap();
    let text = String::from_utf8_lossy(&result);
    assert!(
        text.contains("X-Api-Key: proxy-tok"),
        "X-Api-Key missing: {text}"
    );
}

#[test]
fn rewrite_preserves_body() {
    let request = b"POST /v1/chat HTTP/1.1\r\nHost: api.openai.com\r\nContent-Length: 13\r\nAuthorization: Bearer proxy-tok\r\n\r\n{\"test\":true}";
    let result = rewrite_request(
        request,
        "api.openai.com",
        "proxy-tok",
        "https://proxy.soyd.io",
    )
    .unwrap();
    let text = String::from_utf8_lossy(&result);
    assert!(
        text.ends_with("\r\n\r\n{\"test\":true}"),
        "Body not preserved: {text}"
    );
}

#[test]
fn rewrite_adds_host_when_missing() {
    let request = b"GET /v1/models HTTP/1.1\r\n\r\n";
    let result = rewrite_request(
        request,
        "api.openai.com",
        "proxy-tok",
        "https://proxy.soyd.io",
    )
    .unwrap();
    let text = String::from_utf8_lossy(&result);
    assert!(
        text.contains("Host: proxy.soyd.io"),
        "Host not added: {text}"
    );
}

#[test]
fn rewrite_replaces_kiro_fake_aws_token() {
    let request = b"POST /invoke HTTP/1.1\r\nHost: us-east-1.bedrock-runtime.amazonaws.com\r\nAuthorization: Bearer aoaAAAAAfaketoken\r\n\r\n";
    let result = rewrite_request(
        request,
        "us-east-1.bedrock-runtime.amazonaws.com",
        "proxy-tok",
        "https://proxy.soyd.io",
    )
    .unwrap();
    let text = String::from_utf8_lossy(&result);
    assert!(
        text.contains("Authorization: Bearer proxy-tok"),
        "Kiro fake token not replaced: {text}"
    );
}
