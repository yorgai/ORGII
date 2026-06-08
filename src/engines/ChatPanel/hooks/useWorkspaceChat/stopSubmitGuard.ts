interface SuppressedRestoredSubmit {
  sessionId: string;
  displayContent: string;
  imageDataUrls: string[];
  expiresAt: number;
}

const restoredSubmitSuppression: SuppressedRestoredSubmit = {
  sessionId: "",
  displayContent: "",
  imageDataUrls: [],
  expiresAt: 0,
};

const restoredStopDraftSessionIds = new Set<string>();

function normalizedImages(imageDataUrls?: string[]): string[] {
  return imageDataUrls ?? [];
}

export function suppressRestoredStopSubmit(options: {
  sessionId: string;
  displayContent: string;
  imageDataUrls?: string[];
  ttlMs?: number;
}): void {
  restoredSubmitSuppression.sessionId = options.sessionId;
  restoredSubmitSuppression.displayContent = options.displayContent;
  restoredSubmitSuppression.imageDataUrls = normalizedImages(
    options.imageDataUrls
  );
  restoredSubmitSuppression.expiresAt = Date.now() + (options.ttlMs ?? 50);
}

export function markRestoredStopDraft(sessionId: string): void {
  restoredStopDraftSessionIds.add(sessionId);
}

export function consumeRestoredStopDraft(sessionId: string): boolean {
  if (!restoredStopDraftSessionIds.has(sessionId)) return false;
  restoredStopDraftSessionIds.delete(sessionId);
  return true;
}

export function clearRestoredStopDraft(sessionId: string): void {
  restoredStopDraftSessionIds.delete(sessionId);
}

export function consumeRestoredStopSubmitSuppression(options: {
  sessionId: string;
  displayContent: string;
  imageDataUrls?: string[];
  now?: number;
}): boolean {
  const now = options.now ?? Date.now();
  if (restoredSubmitSuppression.expiresAt <= now) return false;
  if (restoredSubmitSuppression.sessionId !== options.sessionId) return false;
  if (restoredSubmitSuppression.displayContent !== options.displayContent) {
    return false;
  }
  const incomingImages = normalizedImages(options.imageDataUrls);
  if (
    JSON.stringify(restoredSubmitSuppression.imageDataUrls) !==
    JSON.stringify(incomingImages)
  ) {
    return false;
  }
  restoredSubmitSuppression.expiresAt = 0;
  return true;
}
