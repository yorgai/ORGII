//! SAS (short authentication string) generation for the pairing flow.
//!
//! TODO(phase-4): swap the 16-word demo list for the EFF Diceware large
//! wordlist (7776 words) so each phrase carries the documented ~50 bits
//! of entropy. Until then the surface is wired but the entropy is
//! intentionally not real.

use orgii_protocol::ConfirmationPhrase;
use rand::{seq::IndexedRandom, Rng};

/// Demo wordlist. INTENTIONALLY tiny — placeholder until the Diceware
/// wordlist is bundled. Picked to be unambiguous when read aloud over
/// a phone call, since the SAS UX is "compare what's on screen".
const DEMO_WORDLIST: &[&str] = &[
    "amber", "basalt", "crimson", "delta", "ember", "falcon", "granite", "harbor", "indigo",
    "jasper", "kestrel", "lichen", "marble", "nebula", "onyx", "petal",
];

/// Generate a fresh confirmation phrase of the form
/// `"word1-word2-NNNN"`.
///
/// Uses [`rand::rng`] (CSPRNG) so the demo phrase is at least
/// non-guessable per call, even though the wordlist itself is small.
/// The real Diceware implementation in Phase 4 will use 3 words from a
/// 7776-word list to hit the documented ~50 bits of entropy.
pub fn generate() -> ConfirmationPhrase {
    let mut rng = rand::rng();
    let words: Vec<&&str> = DEMO_WORDLIST.choose_multiple(&mut rng, 2).collect();
    let digits: u16 = rng.random_range(1000..=9999);
    let phrase = format!("{}-{}-{}", words[0], words[1], digits);
    ConfirmationPhrase::new(phrase)
}

#[cfg(test)]
#[path = "confirmation_phrase_tests.rs"]
mod tests;
