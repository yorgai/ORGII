//! Pure-logic tests for the power-management idempotency state machine.
//!
//! The real FFI (IOKit / SetThreadExecutionState) is not exercised here — it
//! needs the OS at runtime. What IS exercised is the contract that the Tauri
//! commands enforce on top of the FFI: "two acquires in a row must skip the
//! second call, two releases in a row must skip the second call, and the
//! state must alternate cleanly for any acquire/release sequence."
//!
//! If these tests drift from the command implementation, we'd silently end
//! up holding multiple macOS IOPMAssertions per process (leaking until exit)
//! or calling `SetThreadExecutionState` with mismatched flags.

use crate::power::{decide_acquire, decide_release, Transition};

#[test]
fn acquire_when_not_held_applies_the_call() {
    assert_eq!(decide_acquire(false), Transition::Apply);
}

#[test]
fn acquire_when_already_held_is_a_noop() {
    assert_eq!(decide_acquire(true), Transition::Skip);
}

#[test]
fn release_when_held_applies_the_call() {
    assert_eq!(decide_release(true), Transition::Apply);
}

#[test]
fn release_when_not_held_is_a_noop() {
    assert_eq!(decide_release(false), Transition::Skip);
}

/// Walk a realistic acquire/release sequence and verify the held-flag is
/// driven solely by the `Transition::Apply` outcomes. This is the smallest
/// useful end-to-end shape: it simulates what the Tauri commands do without
/// any FFI, and asserts the idempotency property holds for repeated calls
/// in both directions.
#[test]
fn realistic_sequence_preserves_idempotency() {
    let mut held = false;

    // First acquire → applies.
    assert_eq!(decide_acquire(held), Transition::Apply);
    held = true;

    // Second acquire → no-op (would otherwise leak a macOS assertion ID).
    assert_eq!(decide_acquire(held), Transition::Skip);
    // held stays true.

    // First release → applies.
    assert_eq!(decide_release(held), Transition::Apply);
    held = false;

    // Second release → no-op.
    assert_eq!(decide_release(held), Transition::Skip);
    // held stays false.

    // Acquire again after a full release → applies.
    assert_eq!(decide_acquire(held), Transition::Apply);
}
