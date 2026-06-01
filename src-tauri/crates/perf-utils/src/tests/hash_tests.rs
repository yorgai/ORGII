use crate::hash::*;

#[test]
fn test_sha256() {
    let result = compute_sha256("hello".to_string());
    // Known SHA-256 hash of "hello"
    assert_eq!(
        result.hash,
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
}

#[test]
fn test_blake3() {
    let result = compute_blake3("hello".to_string());
    // Blake3 produces 256-bit (64 hex chars) output
    assert_eq!(result.hash.len(), 64);
    assert_eq!(result.algorithm, "Blake3");
}
