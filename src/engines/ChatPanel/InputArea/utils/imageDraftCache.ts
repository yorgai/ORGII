import type { ChatImageAttachment } from "@src/store/ui/chatImageAtom";

const IMAGE_DRAFT_STORAGE_PREFIX = "orgii:chat-image-draft:";

function storageKey(sessionId: string): string {
  return `${IMAGE_DRAFT_STORAGE_PREFIX}${sessionId}`;
}

function isImageAttachment(value: unknown): value is ChatImageAttachment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatImageAttachment>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.dataUrl === "string" &&
    typeof candidate.fileName === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

export function readImageDraft(sessionId: string): ChatImageAttachment[] {
  if (!sessionId) return [];
  const raw = window.localStorage.getItem(storageKey(sessionId));
  if (!raw) return [];

  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isImageAttachment);
}

export function writeImageDraft(
  sessionId: string,
  images: ChatImageAttachment[]
): void {
  if (!sessionId) return;
  const key = storageKey(sessionId);
  if (images.length === 0) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(images));
}

export function clearImageDraft(sessionId: string): void {
  if (!sessionId) return;
  window.localStorage.removeItem(storageKey(sessionId));
}
