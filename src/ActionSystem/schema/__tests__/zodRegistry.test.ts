import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { defineZodAction } from "../defineZodAction";
import { ZodActionRegistry } from "../zodRegistry";

describe("ZodActionRegistry", () => {
  describe("register / has / get / getActionIds / unregister", () => {
    let registry: ZodActionRegistry;

    beforeEach(() => {
      registry = new ZodActionRegistry();
    });

    it("registers an action and reports has, get, and getActionIds", () => {
      const action = defineZodAction(
        {
          id: "test.echo",
          category: "app",
          description: "Echo value",
          params: z.object({ value: z.string() }),
        },
        async ({ value }) => ({ success: true, message: value })
      );

      expect(registry.has("test.echo")).toBe(false);
      registry.register(action);
      expect(registry.has("test.echo")).toBe(true);
      expect(registry.get("test.echo")).toBe(action);
      expect(registry.getActionIds()).toContain("test.echo");
    });

    it("unregister removes the action from lookups", () => {
      const action = defineZodAction(
        {
          id: "test.temp",
          category: "app",
          description: "Temporary",
          params: z.object({}),
        },
        async () => ({ success: true })
      );

      registry.register(action);
      expect(registry.has("test.temp")).toBe(true);

      registry.unregister("test.temp");
      expect(registry.has("test.temp")).toBe(false);
      expect(registry.get("test.temp")).toBeUndefined();
      expect(registry.getActionIds()).not.toContain("test.temp");
    });
  });

  describe("execute", () => {
    let registry: ZodActionRegistry;

    beforeEach(() => {
      registry = new ZodActionRegistry();
    });

    it("returns success false and message containing Unknown action for unknown id", async () => {
      const result = await registry.execute("nonexistent.action", {});

      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown action");
    });

    it("returns success false and message containing Validation failed on invalid payload", async () => {
      const action = defineZodAction(
        {
          id: "test.validated",
          category: "app",
          description: "Requires count",
          params: z.object({ count: z.number() }),
        },
        async () => ({ success: true })
      );
      registry.register(action);

      const result = await registry.execute("test.validated", {
        count: "not-a-number",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("Validation failed");
    });

    it("returns the handler ActionResult on success", async () => {
      const action = defineZodAction(
        {
          id: "test.ok",
          category: "app",
          description: "Returns data",
          params: z.object({ label: z.string() }),
        },
        async ({ label }) => ({
          success: true,
          message: `done:${label}`,
          data: { id: 42 },
        })
      );
      registry.register(action);

      const result = await registry.execute("test.ok", { label: "x" });

      expect(result.success).toBe(true);
      expect(result.message).toBe("done:x");
      expect(result.data).toEqual({ id: 42 });
    });
  });

  describe("getByLayer / getADEExposedActions", () => {
    let registry: ZodActionRegistry;

    beforeEach(() => {
      registry = new ZodActionRegistry();
      const guiDefault = defineZodAction(
        {
          id: "layer.guiDefault",
          category: "view",
          description: "Implicit gui layer",
          params: z.object({}),
        },
        async () => ({ success: true })
      );
      const guiExplicit = defineZodAction(
        {
          id: "layer.guiExplicit",
          category: "view",
          description: "Explicit gui",
          layer: "gui",
          params: z.object({}),
        },
        async () => ({ success: true })
      );
      const actionLayer = defineZodAction(
        {
          id: "layer.actionOnly",
          category: "file",
          description: "Action layer",
          layer: "action",
          params: z.object({}),
        },
        async () => ({ success: true })
      );
      registry.register(guiDefault);
      registry.register(guiExplicit);
      registry.register(actionLayer);
    });

    it("getByLayer gui includes default and explicit gui actions", () => {
      const guiActions = registry.getByLayer("gui");
      const ids = guiActions.map((a) => a.meta.id).sort();

      expect(ids).toEqual(["layer.guiDefault", "layer.guiExplicit"]);
    });

    it("getByLayer action returns only action-layer actions", () => {
      const actionActions = registry.getByLayer("action");
      expect(actionActions.map((a) => a.meta.id)).toEqual(["layer.actionOnly"]);
    });

    it("getADEExposedActions returns only gui-layer actions", () => {
      const exposed = registry.getADEExposedActions();
      const ids = exposed.map((a) => a.meta.id).sort();

      expect(ids).toEqual(["layer.guiDefault", "layer.guiExplicit"]);
    });

    it("getGUIControlManifest preserves GUI action metadata and excludes action-layer actions", () => {
      const manifest = registry.getGUIControlManifest();
      const ids = manifest.actions.map((action) => action.id);

      expect(ids).toEqual(["layer.guiDefault", "layer.guiExplicit"]);
      expect(ids).not.toContain("layer.actionOnly");
      expect(manifest.actions[0]).toMatchObject({
        kind: "action",
        id: "layer.guiDefault",
        category: "view",
        description: "Implicit gui layer",
        layer: "gui",
        tags: [],
        examples: [],
      });
      expect(manifest.actions[0].paramsSchema).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(
          manifest.actions[0].paramsSchema as Record<string, unknown>,
          "$schema"
        )
      ).toBe(false);
    });
  });

  describe("getActionLayer", () => {
    let registry: ZodActionRegistry;

    beforeEach(() => {
      registry = new ZodActionRegistry();
    });

    it("returns undefined for a missing action id", () => {
      expect(registry.getActionLayer("missing.id")).toBeUndefined();
    });

    it("returns gui for default layer and action for explicit action layer", () => {
      registry.register(
        defineZodAction(
          {
            id: "layer.probeDefault",
            category: "app",
            description: "Default",
            params: z.object({}),
          },
          async () => ({ success: true })
        )
      );
      registry.register(
        defineZodAction(
          {
            id: "layer.probeAction",
            category: "file",
            description: "Native",
            layer: "action",
            params: z.object({}),
          },
          async () => ({ success: true })
        )
      );

      expect(registry.getActionLayer("layer.probeDefault")).toBe("gui");
      expect(registry.getActionLayer("layer.probeAction")).toBe("action");
    });
  });
});
