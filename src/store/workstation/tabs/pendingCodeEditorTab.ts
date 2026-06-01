let pendingTabId: string | null = null;

export function queuePendingCodeEditorTab(tabId: string): void {
  pendingTabId = tabId;
}

export function consumePendingCodeEditorTab(): string | null {
  const tabId = pendingTabId;
  pendingTabId = null;
  return tabId;
}
