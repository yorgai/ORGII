import type { MutableRefObject } from "react";

export function clearInitTimeout(
  initTimeoutRef: MutableRefObject<NodeJS.Timeout | null>
) {
  if (initTimeoutRef.current) {
    clearTimeout(initTimeoutRef.current);
    initTimeoutRef.current = null;
  }
}

export function cleanupPtyListeners({
  unlistenOutputRef,
  unlistenExitRef,
}: {
  unlistenOutputRef: MutableRefObject<(() => void) | null>;
  unlistenExitRef: MutableRefObject<(() => void) | null>;
}) {
  if (unlistenOutputRef.current) {
    unlistenOutputRef.current();
    unlistenOutputRef.current = null;
  }

  if (unlistenExitRef.current) {
    unlistenExitRef.current();
    unlistenExitRef.current = null;
  }
}
