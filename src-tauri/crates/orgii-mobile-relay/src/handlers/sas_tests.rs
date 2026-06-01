use super::*;

#[test]
fn pairing_code_has_expected_length_and_alphabet() {
    let code = generate_pairing_code();
    let s = code.as_str();
    assert_eq!(s.len(), PAIRING_CODE_LEN);
    for ch in s.chars() {
        assert!(
            PAIRING_CODE_ALPHABET.contains(&(ch as u8)),
            "char {ch} outside alphabet",
        );
    }
}

#[test]
fn pairing_code_is_not_constant_across_calls() {
    // Probability of collision over 16 draws from a 30^8 space is
    // vanishingly small; if this trips, we likely broke RNG seeding.
    let mut codes = std::collections::HashSet::new();
    for _ in 0..16 {
        codes.insert(generate_pairing_code());
    }
    assert!(codes.len() > 1, "RNG produced identical codes");
}

#[test]
fn confirmation_phrase_has_three_words_and_four_digit_suffix() {
    let phrase = generate_confirmation_phrase();
    let s = phrase.as_str();
    let parts: Vec<&str> = s.split('-').collect();
    assert_eq!(parts.len(), 4, "shape: word-word-word-NNNN, got {s}");
    for word in &parts[..3] {
        assert!(
            !word.is_empty() && word.chars().all(|c| c.is_ascii_lowercase()),
            "word {word} not lowercase ascii",
        );
    }
    let suffix = parts[3];
    assert_eq!(suffix.len(), 4);
    assert!(suffix.chars().all(|c| c.is_ascii_digit()));
}

#[test]
fn confirmation_phrase_uses_distinct_words_within_one_phrase() {
    let phrase = generate_confirmation_phrase();
    let s = phrase.as_str();
    let parts: Vec<&str> = s.split('-').take(3).collect();
    let unique: std::collections::HashSet<_> = parts.iter().collect();
    assert_eq!(unique.len(), 3, "words must not repeat: {s}");
}
