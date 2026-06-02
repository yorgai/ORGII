export const CHAT_PREVIEW_TYPE = {
  QUEUED: "chat_queued_messages",
  TERMINAL: "chat_terminal_processes",
  REVIEW: "chat_file_review",
  MODE_SWITCH: "chat_mode_switch",
  RECONNECTING: "chat_reconnecting",
  RATE_LIMITED: "chat_rate_limited",
  INTERVENTION: "chat_intervention",
  PAUSED: "chat_paused",
  PINNED_ACTIONS: "chat_pinned_actions",
} as const;

export type ChatPreviewType =
  (typeof CHAT_PREVIEW_TYPE)[keyof typeof CHAT_PREVIEW_TYPE];

export const CHAT_PREVIEW_TYPES = [
  CHAT_PREVIEW_TYPE.PINNED_ACTIONS,
  CHAT_PREVIEW_TYPE.PAUSED,
  CHAT_PREVIEW_TYPE.RECONNECTING,
  CHAT_PREVIEW_TYPE.RATE_LIMITED,
  CHAT_PREVIEW_TYPE.INTERVENTION,
  CHAT_PREVIEW_TYPE.MODE_SWITCH,
  CHAT_PREVIEW_TYPE.QUEUED,
  CHAT_PREVIEW_TYPE.TERMINAL,
  CHAT_PREVIEW_TYPE.REVIEW,
] as const;

const CHAT_PREVIEW_TYPE_SET = new Set<string>(CHAT_PREVIEW_TYPES);

export function isChatPreviewType(
  eventType: string
): eventType is ChatPreviewType {
  return CHAT_PREVIEW_TYPE_SET.has(eventType);
}

export function getChatPreviewTypeLabel(eventType: string): string | null {
  switch (eventType) {
    case CHAT_PREVIEW_TYPE.QUEUED:
      return "Chat · Queued messages";
    case CHAT_PREVIEW_TYPE.TERMINAL:
      return "Chat · Terminal processes";
    case CHAT_PREVIEW_TYPE.REVIEW:
      return "Chat · File review";
    case CHAT_PREVIEW_TYPE.RECONNECTING:
      return "Chat · Reconnecting";
    case CHAT_PREVIEW_TYPE.RATE_LIMITED:
      return "Chat · Rate limited";
    case CHAT_PREVIEW_TYPE.INTERVENTION:
      return "Chat · Intervention";
    case CHAT_PREVIEW_TYPE.MODE_SWITCH:
      return "Chat · Mode switch";
    case CHAT_PREVIEW_TYPE.PAUSED:
      return "Chat · Resume work";
    case CHAT_PREVIEW_TYPE.PINNED_ACTIONS:
      return "Chat · Pinned actions bar";
    default:
      return null;
  }
}
