/**
 * Tests for WorkStationShell configuration helpers.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRIMARY_SIDEBAR_CONFIG,
  buildPrimarySidebarConfig,
  buildSecondaryPanelConfig,
} from "../config";

describe("WorkStationShell config", () => {
  describe("DEFAULT_PRIMARY_SIDEBAR_CONFIG", () => {
    it("has expected default values", () => {
      expect(DEFAULT_PRIMARY_SIDEBAR_CONFIG).toEqual({
        size: 240,
        collapsed: false,
        minSize: 200,
        maxSize: 500,
        resetSize: 240,
      });
    });
  });

  describe("buildPrimarySidebarConfig", () => {
    it("uses defaults when only content is provided", () => {
      const config = buildPrimarySidebarConfig({
        content: "test-content",
      });

      expect(config).toEqual({
        content: "test-content",
        collapsed: false,
        size: 240,
        onSizeChange: undefined,
        onClose: undefined,
        minSize: 200,
        maxSize: 500,
        resetSize: 240,
      });
    });

    it("overrides defaults with provided values", () => {
      const onSizeChange = () => {};
      const onClose = () => {};

      const config = buildPrimarySidebarConfig({
        content: "custom-content",
        collapsed: true,
        size: 300,
        onSizeChange,
        onClose,
        minSize: 150,
        maxSize: 450,
        resetSize: 280,
      });

      expect(config).toEqual({
        content: "custom-content",
        collapsed: true,
        size: 300,
        onSizeChange,
        onClose,
        minSize: 150,
        maxSize: 450,
        resetSize: 280,
      });
    });

    it("allows partial overrides", () => {
      const config = buildPrimarySidebarConfig({
        content: "partial",
        collapsed: true,
        size: 280,
      });

      expect(config.collapsed).toBe(true);
      expect(config.size).toBe(280);
      expect(config.minSize).toBe(200); // default
      expect(config.maxSize).toBe(500); // default
    });
  });

  describe("buildSecondaryPanelConfig", () => {
    it("produces a right-positioned panel with sensible defaults", () => {
      const config = buildSecondaryPanelConfig({
        content: "devtools",
        position: "right",
        size: 400,
      });

      expect(config).toEqual({
        content: "devtools",
        position: "right",
        collapsed: false,
        maximized: false,
        size: 400,
        onSizeChange: undefined,
        onClose: undefined,
        minSize: undefined,
        maxSize: undefined,
        resetSize: undefined,
      });
    });

    it("passes through bottom-position maximized state", () => {
      const config = buildSecondaryPanelConfig({
        content: "terminal",
        position: "bottom",
        size: 300,
        maximized: true,
      });

      expect(config.position).toBe("bottom");
      expect(config.maximized).toBe(true);
    });

    it("forwards resize and close callbacks", () => {
      const onSizeChange = () => {};
      const onClose = () => {};

      const config = buildSecondaryPanelConfig({
        content: "panel",
        position: "right",
        size: 400,
        onSizeChange,
        onClose,
        minSize: 200,
        maxSize: 800,
        resetSize: 400,
      });

      expect(config.onSizeChange).toBe(onSizeChange);
      expect(config.onClose).toBe(onClose);
      expect(config.minSize).toBe(200);
      expect(config.maxSize).toBe(800);
      expect(config.resetSize).toBe(400);
    });
  });
});
