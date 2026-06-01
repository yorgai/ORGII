/**
 * Toast — re-exports the canonical Message component.
 *
 * `src/components/Message` is the primary notification system (90+ callers,
 * Framer Motion animations, dedup logic, 1 s default duration).
 * This file was a parallel implementation (CSS animations, 3 s default).
 *
 * All new code should import from `@src/components/Message`. This re-export
 * exists only for backward compatibility with the 12 existing callers so they
 * don't need to be migrated all at once.
 */
export { default, Message } from "@src/components/Message";
export type { MessageConfig as ToastConfig } from "@src/components/Message";
