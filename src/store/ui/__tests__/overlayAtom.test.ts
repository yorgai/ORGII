import { createStore } from "jotai/vanilla";
import { vi } from "vitest";

import { webviewOverlayBlockedAtom } from "../overlayAtom";
import { activeOverlayCountAtom } from "../overlayLayerAtom";
import { viewModeAtom } from "../viewModeAtom";

vi.mock("@src/util/platform/tauri", () => ({
  isMacOS: () => false,
}));

describe("webviewOverlayBlockedAtom", () => {
  it("blocks native webviews for overlays when native layering is unavailable", () => {
    const store = createStore();
    store.set(viewModeAtom, "workStation");

    expect(store.get(webviewOverlayBlockedAtom)).toBe(false);

    store.set(activeOverlayCountAtom, 1);
    expect(store.get(webviewOverlayBlockedAtom)).toBe(true);

    store.set(activeOverlayCountAtom, 0);
    expect(store.get(webviewOverlayBlockedAtom)).toBe(false);
  });
});
