/**
 * Inbox Types
 *
 * Re-exported from the canonical API types layer so Inbox UI components can
 * keep their existing import path while the store layer reads from src/api/.
 */
export type {
  InboxCategory,
  MessagePriority,
  MessageStatus,
  InboxMessage,
  DateGroup,
} from "@src/api/types/inbox";
