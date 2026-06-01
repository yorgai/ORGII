//! Pairing-code and confirmation-phrase generators.
//!
//! Both are deliberately kept small and self-contained so the handler
//! logic stays focused on the IO. Cryptographic strength comes from
//! `rand::rngs::OsRng` (the OS CSPRNG); the alphabet / wordlist
//! choices below are purely about user-readability — see the design
//! doc's "Auth & Pairing" section.

use orgii_protocol::{ConfirmationPhrase, PairingCode};
use rand::seq::IndexedRandom;
use rand::Rng;

/// Base32-style alphabet, minus look-alikes (`0`/`O`, `1`/`I`/`L`).
/// 8 chars at 30 symbols ≈ 39 bits — comfortably enough entropy for
/// a 10-minute TTL given the per-IP rate limit added in Phase 9.
const PAIRING_CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LEN: usize = 8;

/// Generate a fresh, unbiased [`PairingCode`].
pub fn generate_pairing_code() -> PairingCode {
    let mut rng = rand::rng();
    let chars: String = (0..PAIRING_CODE_LEN)
        .map(|_| {
            let idx = rng.random_range(0..PAIRING_CODE_ALPHABET.len());
            PAIRING_CODE_ALPHABET[idx] as char
        })
        .collect();
    PairingCode::new(chars)
}

/// Stub Diceware-style wordlist. Three words plus a 4-digit suffix
/// gives ~`log2(LIST.len()^3 * 10000)` ≈ 26+ bits — good enough for
/// the SAS phrase to carry the load even before we swap in the real
/// 7776-word EFF list.
///
/// TODO(phase 9 hardening): replace with the EFF short word list 1
/// from <https://www.eff.org/dice> (1296 words; produces ~31 bits
/// for 3 words, then +13 bits for the suffix). The list should be
/// embedded via `include_str!` to avoid reading from disk at
/// pair-init time.
const PHRASE_WORDS: &[&str] = &[
    "amber", "anchor", "apple", "atlas", "azure", "beacon", "bishop", "bramble", "bronze",
    "cactus", "cedar", "circus", "clover", "comet", "copper", "coral", "crimson", "delta", "echo",
    "ember", "falcon", "feather", "forest", "garnet", "harbor", "ivory", "juniper", "kestrel",
    "lantern", "marble", "meadow", "moss", "nebula", "olive", "orbit", "phoenix", "quartz",
    "raven", "river", "saffron", "sienna", "spruce", "summit", "tundra", "umber", "valley",
    "willow", "wisp", "yarrow", "zephyr",
];

/// Three-word + four-digit phrase, e.g. `"crimson-falcon-beacon-7392"`.
/// Always lowercase and hyphen-separated so it renders identically on
/// any device.
pub fn generate_confirmation_phrase() -> ConfirmationPhrase {
    let mut rng = rand::rng();
    let words: Vec<&&str> = PHRASE_WORDS.choose_multiple(&mut rng, 3).collect();
    let suffix: u16 = rng.random_range(0..10_000);
    ConfirmationPhrase::new(format!(
        "{}-{}-{}-{:04}",
        words[0], words[1], words[2], suffix
    ))
}

#[cfg(test)]
#[path = "sas_tests.rs"]
mod tests;
