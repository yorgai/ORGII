use super::*;

#[test]
fn phrase_has_two_words_and_four_digits() {
    let phrase = generate();
    let s = phrase.as_str();
    let parts: Vec<&str> = s.split('-').collect();
    assert_eq!(parts.len(), 3, "expected 2 words + 4 digits, got {s:?}");
    assert!(
        parts[0].chars().all(|c| c.is_ascii_lowercase()),
        "word0 should be lowercase letters: {s:?}"
    );
    assert!(
        parts[1].chars().all(|c| c.is_ascii_lowercase()),
        "word1 should be lowercase letters: {s:?}"
    );
    assert_eq!(
        parts[2].len(),
        4,
        "digit suffix should be exactly 4 chars: {s:?}"
    );
    assert!(
        parts[2].chars().all(|c| c.is_ascii_digit()),
        "digit suffix should be digits: {s:?}"
    );
}

#[test]
fn phrase_contains_two_hyphens() {
    let phrase = generate();
    let hyphen_count = phrase.as_str().chars().filter(|c| *c == '-').count();
    assert_eq!(hyphen_count, 2, "want 2 hyphens: {phrase:?}");
}

#[test]
fn phrase_is_non_empty() {
    let phrase = generate();
    assert!(!phrase.as_str().is_empty());
}
