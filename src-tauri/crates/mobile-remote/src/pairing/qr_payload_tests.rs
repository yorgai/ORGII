use super::*;
use orgii_protocol::{ConfirmationPhrase, DesktopId, PairingCode};

fn sample() -> QrPayload {
    QrPayload {
        relay_url: "https://relay.example".into(),
        pairing_code: PairingCode::new("ABC123"),
        desktop_id: DesktopId::new("desk-home"),
        fingerprint_hex: QrPayload::fingerprint_from_phrase(&ConfirmationPhrase::new(
            "crimson-falcon-7392",
        )),
    }
}

#[test]
fn fingerprint_is_deterministic() {
    let phrase = ConfirmationPhrase::new("crimson-falcon-7392");
    let one = QrPayload::fingerprint_from_phrase(&phrase);
    let two = QrPayload::fingerprint_from_phrase(&phrase);
    assert_eq!(one, two);
}

#[test]
fn fingerprint_changes_with_input() {
    let a = QrPayload::fingerprint_from_phrase(&ConfirmationPhrase::new("a-b-1234"));
    let b = QrPayload::fingerprint_from_phrase(&ConfirmationPhrase::new("a-b-1235"));
    assert_ne!(a, b);
}

#[test]
fn fingerprint_is_32_hex_chars() {
    let fp = QrPayload::fingerprint_from_phrase(&ConfirmationPhrase::new("crimson-falcon-7392"));
    assert_eq!(fp.len(), 32, "16 bytes hex-encoded = 32 chars: {fp}");
    assert!(
        fp.chars().all(|c| c.is_ascii_hexdigit()),
        "expected hex chars: {fp}"
    );
}

#[test]
fn to_json_round_trips() {
    let payload = sample();
    let wire = payload.to_json();
    let back: QrPayload = serde_json::from_str(&wire).expect("deserialize");
    assert_eq!(payload, back);
}

#[test]
fn to_json_uses_camel_case_keys() {
    let wire = sample().to_json();
    assert!(wire.contains("relayUrl"), "want camelCase: {wire}");
    assert!(wire.contains("pairingCode"), "want camelCase: {wire}");
    assert!(wire.contains("desktopId"), "want camelCase: {wire}");
    assert!(wire.contains("fingerprintHex"), "want camelCase: {wire}");
}
