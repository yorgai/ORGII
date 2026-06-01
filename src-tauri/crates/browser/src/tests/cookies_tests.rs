use crate::cookies::{matches_domain, parse_domain_filter};

#[test]
fn parse_domain_filter_valid_url() {
    let result = parse_domain_filter(Some("https://example.com/path"));
    assert_eq!(result, Some("example.com".to_string()));
}

#[test]
fn parse_domain_filter_url_with_port() {
    let result = parse_domain_filter(Some("https://example.com:8080/foo"));
    assert_eq!(result, Some("example.com".to_string()));
}

#[test]
fn parse_domain_filter_invalid_url() {
    let result = parse_domain_filter(Some("not a url"));
    assert_eq!(result, None);
}

#[test]
fn parse_domain_filter_none_input() {
    let result = parse_domain_filter(None);
    assert_eq!(result, None);
}

#[test]
fn parse_domain_filter_url_with_subdomain() {
    let result = parse_domain_filter(Some("https://sub.example.com"));
    assert_eq!(result, Some("sub.example.com".to_string()));
}

#[test]
fn matches_domain_exact_via_contains() {
    assert!(matches_domain(
        &Some(".example.com".to_string()),
        "example.com"
    ));
}

#[test]
fn matches_domain_subdomain_via_filter_contains() {
    assert!(matches_domain(
        &Some(".sub.example.com".to_string()),
        "example.com"
    ));
}

#[test]
fn matches_domain_none_cookie_domain() {
    assert!(!matches_domain(&None, "example.com"));
}

#[test]
fn matches_domain_no_match() {
    assert!(!matches_domain(
        &Some("other.com".to_string()),
        "example.com"
    ));
}

#[test]
fn matches_domain_parent_via_filter_ends_with() {
    assert!(matches_domain(
        &Some("example.com".to_string()),
        "sub.example.com"
    ));
}

#[test]
fn matches_domain_dot_prefixed_cookie() {
    assert!(matches_domain(
        &Some(".github.com".to_string()),
        "github.com"
    ));
}
