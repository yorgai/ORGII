export async function waitForSessionSurface(sessionId: string): Promise<void> {
  const timeoutAt = Date.now() + 2_000;
  while (Date.now() < timeoutAt) {
    const tab = document.querySelector(`[data-session-tab="${sessionId}"]`);
    const chatView = document.querySelector("[data-chat-view-root]");
    if (tab && chatView) return;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}
