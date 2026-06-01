/**
 * Cooldown for user-initiated terminal creation to prevent rapid duplicate tabs.
 */
import Message from "@src/components/Message";
import i18n from "@src/i18n";

/** Minimum interval between creating terminals (milliseconds). */
export const TERMINAL_CREATION_COOLDOWN_MS = 1000;

let lastTerminalCreationTime = 0;

/**
 * Returns true if a new terminal may be created; false if still within cooldown.
 * On success, records the timestamp.
 */
export function tryBeginTerminalCreation(): boolean {
  const now = Date.now();
  if (now - lastTerminalCreationTime < TERMINAL_CREATION_COOLDOWN_MS) {
    return false;
  }
  lastTerminalCreationTime = now;
  return true;
}

/** Show a localized warning when creation is blocked by cooldown. */
export function notifyTerminalCreationCooldown(): void {
  Message.warning(i18n.t("sessions:terminal.creationCooldown"));
}
