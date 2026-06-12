/**
 * Unit tests for defineZodAction, zodActionToLLMTool, and
 * zodActionToGUIControlManifestAction.
 *
 * The ZodActionRegistry is already covered by zodRegistry.test.ts.
 * These tests cover the pure builder/serialiser helpers that were
 * previously untested.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  defineZodAction,
  zodActionToGUIControlManifestAction,
  zodActionToLLMTool,
} from "../defineZodAction";

// ---------------------------------------------------------------------------
// defineZodAction
// ---------------------------------------------------------------------------

describe("defineZodAction — basic structure", () => {
  it("returns an object with meta and execute properties", () => {
    const executor = vi.fn().mockResolvedValue({ success: true });
    const action = defineZodAction(
      {
        id: "test.simple",
        category: "app",
        description: "Simple test action",
        params: z.object({ value: z.string() }),
      },
      executor
    );

    expect(action.meta.id).toBe("test.simple");
    expect(action.meta.category).toBe("app");
    expect(action.meta.description).toBe("Simple test action");
    expect(typeof action.execute).toBe("function");
  });

  it("execute delegates to the provided handler", async () => {
    const action = defineZodAction(
      {
        id: "test.echo",
        category: "app",
        description: "Echo",
        params: z.object({ msg: z.string() }),
      },
      async ({ msg }) => ({ success: true, message: msg })
    );

    const result = await action.execute({ msg: "hello" });
    expect(result.success).toBe(true);
    expect(result.message).toBe("hello");
  });

  it("preserves optional meta fields (tags, examples, shortcut, undoable, requiresConfirmation)", () => {
    const action = defineZodAction(
      {
        id: "test.rich",
        category: "file",
        description: "Rich",
        params: z.object({}),
        layer: "action",
        tags: ["important"],
        examples: ["do it"],
        shortcut: "Cmd+K",
        undoable: true,
        requiresConfirmation: true,
      },
      async () => ({ success: true })
    );

    expect(action.meta.layer).toBe("action");
    expect(action.meta.tags).toEqual(["important"]);
    expect(action.meta.examples).toEqual(["do it"]);
    expect(action.meta.shortcut).toBe("Cmd+K");
    expect(action.meta.undoable).toBe(true);
    expect(action.meta.requiresConfirmation).toBe(true);
  });

  it("defaults layer to undefined when not specified", () => {
    const action = defineZodAction(
      {
        id: "test.no-layer",
        category: "view",
        description: "No explicit layer",
        params: z.object({}),
      },
      async () => ({ success: true })
    );

    expect(action.meta.layer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// zodActionToLLMTool
// ---------------------------------------------------------------------------

describe("zodActionToLLMTool", () => {
  it("produces a function-type tool definition", () => {
    const action = defineZodAction(
      {
        id: "file.open",
        category: "file",
        description: "Open a file",
        params: z.object({
          path: z.string().describe("File path"),
        }),
      },
      async () => ({ success: true })
    );

    const tool = zodActionToLLMTool(action);
    expect(tool.type).toBe("function");
    expect(tool.function.name).toBe("file_open");
    expect(tool.function.description).toBe("Open a file");
    expect(tool.function.parameters).toBeDefined();
  });

  it("replaces dots with underscores in the tool name", () => {
    const action = defineZodAction(
      {
        id: "editor.tab.switch",
        category: "editor",
        description: "Switch tab",
        params: z.object({}),
      },
      async () => ({ success: true })
    );

    expect(zodActionToLLMTool(action).function.name).toBe("editor_tab_switch");
  });

  it("uses longDescription when present", () => {
    const action = defineZodAction(
      {
        id: "test.long",
        category: "app",
        description: "Short",
        longDescription: "Much longer explanation",
        params: z.object({}),
      },
      async () => ({ success: true })
    );

    expect(zodActionToLLMTool(action).function.description).toBe(
      "Much longer explanation"
    );
  });

  it("does not include $schema in the parameters object", () => {
    const action = defineZodAction(
      {
        id: "test.schema",
        category: "app",
        description: "Schema test",
        params: z.object({ x: z.number() }),
      },
      async () => ({ success: true })
    );

    const params = zodActionToLLMTool(action).function.parameters as Record<
      string,
      unknown
    >;
    expect(Object.prototype.hasOwnProperty.call(params, "$schema")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// zodActionToGUIControlManifestAction
// ---------------------------------------------------------------------------

describe("zodActionToGUIControlManifestAction", () => {
  it("produces a manifest action with kind=action", () => {
    const action = defineZodAction(
      {
        id: "sidebar.toggle",
        category: "sidebar",
        description: "Toggle sidebar",
        params: z.object({}),
      },
      async () => ({ success: true })
    );

    const manifest = zodActionToGUIControlManifestAction(action);
    expect(manifest.kind).toBe("action");
    expect(manifest.id).toBe("sidebar.toggle");
    expect(manifest.category).toBe("sidebar");
    expect(manifest.description).toBe("Toggle sidebar");
  });

  it("defaults layer to gui when meta.layer is undefined", () => {
    const action = defineZodAction(
      {
        id: "test.default-layer",
        category: "app",
        description: "Default layer",
        params: z.object({}),
      },
      async () => ({ success: true })
    );

    expect(zodActionToGUIControlManifestAction(action).layer).toBe("gui");
  });

  it("preserves action layer when explicitly set", () => {
    const action = defineZodAction(
      {
        id: "test.action-layer",
        category: "file",
        description: "Action layer",
        params: z.object({}),
        layer: "action",
      },
      async () => ({ success: true })
    );

    expect(zodActionToGUIControlManifestAction(action).layer).toBe("action");
  });

  it("defaults tags and examples to empty arrays when absent", () => {
    const action = defineZodAction(
      {
        id: "test.no-extras",
        category: "app",
        description: "No extras",
        params: z.object({}),
      },
      async () => ({ success: true })
    );

    const m = zodActionToGUIControlManifestAction(action);
    expect(m.tags).toEqual([]);
    expect(m.examples).toEqual([]);
  });

  it("preserves tags and examples when provided", () => {
    const action = defineZodAction(
      {
        id: "test.with-extras",
        category: "app",
        description: "With extras",
        params: z.object({}),
        tags: ["alpha", "beta"],
        examples: ["do alpha", "do beta"],
      },
      async () => ({ success: true })
    );

    const m = zodActionToGUIControlManifestAction(action);
    expect(m.tags).toEqual(["alpha", "beta"]);
    expect(m.examples).toEqual(["do alpha", "do beta"]);
  });

  it("does not include $schema in the paramsSchema", () => {
    const action = defineZodAction(
      {
        id: "test.params-schema",
        category: "app",
        description: "Params schema check",
        params: z.object({ count: z.number() }),
      },
      async () => ({ success: true })
    );

    const m = zodActionToGUIControlManifestAction(action);
    expect(
      Object.prototype.hasOwnProperty.call(
        m.paramsSchema as Record<string, unknown>,
        "$schema"
      )
    ).toBe(false);
  });

  it("includes longDescription when provided", () => {
    const action = defineZodAction(
      {
        id: "test.long-desc",
        category: "app",
        description: "Short",
        longDescription: "Detailed explanation",
        params: z.object({}),
      },
      async () => ({ success: true })
    );

    const m = zodActionToGUIControlManifestAction(action);
    expect(m.longDescription).toBe("Detailed explanation");
  });

  it("omits longDescription when not provided", () => {
    const action = defineZodAction(
      {
        id: "test.no-long",
        category: "app",
        description: "No long desc",
        params: z.object({}),
      },
      async () => ({ success: true })
    );

    const m = zodActionToGUIControlManifestAction(action);
    expect("longDescription" in m).toBe(false);
  });
});
