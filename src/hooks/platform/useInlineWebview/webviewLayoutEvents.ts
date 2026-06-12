export const WEBVIEW_LAYOUT_CHANGED_EVENT = "orgii-webview-layout-changed";

export function dispatchWebviewLayoutChanged(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new CustomEvent(WEBVIEW_LAYOUT_CHANGED_EVENT));
  });
}
