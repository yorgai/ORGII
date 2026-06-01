/**
 * useCopyCheck — icon swap from Copy → Check on successful copy.
 *
 * Shows a checkmark for CHECK_DURATION_MS (5 s) after a successful copy,
 * then reverts to the default icon. Pairs with a toast/Message on success.
 *
 * @param onCopy - Async callback that performs the copy (clipboard write, etc.)
 * @returns { copied, handleCopy } — `copied` drives the icon swap, `handleCopy` is the click handler
 *
 * @example
 * ```tsx
 * import { Check, Copy } from "lucide-react";
 * import { useCopyCheck } from "@src/hooks/ui";
 *
 * const { copied, handleCopy } = useCopyCheck(async () => {
 *   await copyText(secret);
 *   Message.success({ content: t("common:status.copied") });
 * });
 *
 * <button onClick={handleCopy}>
 *   {copied ? <Check size={13} /> : <Copy size={13} />}
 * </button>
 * ```
 */
import { useCallback, useEffect, useRef, useState } from "react";

const CHECK_DURATION_MS = 5_000;

export function useCopyCheck(onCopy: () => Promise<void>): {
  copied: boolean;
  handleCopy: () => void;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(() => {
    onCopy()
      .then(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setCopied(true);
        timerRef.current = setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, CHECK_DURATION_MS);
      })
      .catch(() => {
        // Copy failed — don't flip icon
      });
  }, [onCopy]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return { copied, handleCopy };
}
