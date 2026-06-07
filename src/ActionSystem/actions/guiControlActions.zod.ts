import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineAppActionRegistration } from "@src/ActionSystem/schema/actionRegistration";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { zodActionRegistry } from "@src/ActionSystem/schema/zodRegistry";

const GUI_CONTROL_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "summary",
  "[role='button']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "[role='switch']",
  "[role='checkbox']",
  "[tabindex]:not([tabindex='-1'])",
  "[data-action]",
  "[data-gui-action]",
  "[data-gui-label]",
].join(",");

const MAX_DOM_CONTROLS = 160;
const MAX_ACTIONS = 180;
const MAX_TEXT_LENGTH = 140;

interface GuiManifestDomControl {
  kind: "dom";
  id: string;
  label: string;
  role: string;
  tagName: string;
  action?: string;
  description?: string;
  disabled: boolean;
  selected?: boolean;
  expanded?: boolean;
  checked?: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface GuiManifest {
  actions: ReturnType<
    typeof zodActionRegistry.getGUIControlManifest
  >["actions"];
  controls: GuiManifestDomControl[];
}

function truncateText(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > MAX_TEXT_LENGTH
    ? `${compact.slice(0, MAX_TEXT_LENGTH - 1)}…`
    : compact;
}

function isElementVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.bottom < 0 || rect.right < 0) return false;
  if (rect.top > window.innerHeight || rect.left > window.innerWidth)
    return false;
  const style = window.getComputedStyle(element);
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity || "1") > 0
  );
}

function getElementRole(element: HTMLElement): string {
  const explicitRole = element.getAttribute("role");
  if (explicitRole) return explicitRole;
  const tagName = element.tagName.toLowerCase();
  if (tagName === "button") return "button";
  if (tagName === "a") return "link";
  if (tagName === "input") {
    const input = element as HTMLInputElement;
    return input.type || "input";
  }
  return tagName;
}

function getAssociatedLabel(element: HTMLElement): string | null {
  if (element instanceof HTMLInputElement && element.labels?.length) {
    return Array.from(element.labels)
      .map((label) => label.textContent ?? "")
      .join(" ")
      .trim();
  }
  return null;
}

function getAccessibleName(element: HTMLElement): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text) return truncateText(text);
  }

  const candidates = [
    element.getAttribute("data-gui-label"),
    element.getAttribute("aria-label"),
    getAssociatedLabel(element),
    element.getAttribute("title"),
    element.textContent,
    element.getAttribute("placeholder"),
    element.getAttribute("data-action"),
    element.getAttribute("data-gui-action"),
  ];

  for (const candidate of candidates) {
    if (candidate && candidate.trim().length > 0)
      return truncateText(candidate);
  }

  return getElementRole(element);
}

function isDisabled(element: HTMLElement): boolean {
  if (element.getAttribute("aria-disabled") === "true") return true;
  if (element instanceof HTMLButtonElement) return element.disabled;
  if (element instanceof HTMLInputElement) return element.disabled;
  if (element instanceof HTMLTextAreaElement) return element.disabled;
  if (element instanceof HTMLSelectElement) return element.disabled;
  return false;
}

function buildDomControl(
  element: HTMLElement,
  index: number
): GuiManifestDomControl {
  const rect = element.getBoundingClientRect();
  const action =
    element.getAttribute("data-gui-action") ??
    element.getAttribute("data-action") ??
    undefined;
  const description = element.getAttribute("data-gui-description") ?? undefined;
  const selected = element.getAttribute("aria-selected");
  const expanded = element.getAttribute("aria-expanded");
  const checked = element.getAttribute("aria-checked");

  return {
    kind: "dom",
    id: `dom:${index}`,
    label: getAccessibleName(element),
    role: getElementRole(element),
    tagName: element.tagName.toLowerCase(),
    ...(action ? { action } : {}),
    ...(description ? { description } : {}),
    disabled: isDisabled(element),
    ...(selected ? { selected: selected === "true" } : {}),
    ...(expanded ? { expanded: expanded === "true" } : {}),
    ...(checked ? { checked: checked === "true" } : {}),
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function collectDomControls(query?: string): GuiManifestDomControl[] {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const elements = Array.from(document.querySelectorAll(GUI_CONTROL_SELECTOR));
  const controls = elements
    .filter(isElementVisible)
    .map(buildDomControl)
    .filter((control) => {
      if (!normalizedQuery) return true;
      const haystack = [
        control.label,
        control.role,
        control.action,
        control.description,
        control.tagName,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .slice(0, MAX_DOM_CONTROLS);

  return controls;
}

function collectGuiActions(query?: string): GuiManifest["actions"] {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  return zodActionRegistry
    .getGUIControlManifest()
    .actions.filter((action) => {
      if (action.id === ACTION_ID.GUI_INSPECT) return false;
      if (action.id === ACTION_ID.GUI_EXECUTE) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        action.id,
        action.category,
        action.description,
        action.longDescription,
        ...(action.tags ?? []),
        ...(action.examples ?? []),
      ]
        .filter((part): part is string => Boolean(part))
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .slice(0, MAX_ACTIONS);
}

function buildGuiManifest(query?: string): GuiManifest {
  return {
    actions: collectGuiActions(query),
    controls: collectDomControls(query),
  };
}

function findDomControlElement(targetId: string): HTMLElement | null {
  const indexText = targetId.startsWith("dom:") ? targetId.slice(4) : "";
  const index = Number.parseInt(indexText, 10);
  if (!Number.isInteger(index) || index < 0) return null;
  const elements = Array.from(document.querySelectorAll(GUI_CONTROL_SELECTOR));
  return elements.filter(isElementVisible)[index] ?? null;
}

function setNativeValue(element: HTMLElement, value: string): boolean {
  if (element instanceof HTMLInputElement) {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLTextAreaElement) {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (element instanceof HTMLSelectElement) {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}

const GuiInspectParamsSchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Optional text filter for actions and visible controls"),
});

const GuiExecuteParamsSchema = z.object({
  targetKind: z.enum(["action", "dom"]),
  actionId: z
    .string()
    .optional()
    .describe("Registered Zod action ID when targetKind is action"),
  targetId: z
    .string()
    .optional()
    .describe("DOM target id from gui.inspect when targetKind is dom"),
  operation: z
    .enum(["click", "focus", "set_value"])
    .optional()
    .describe("DOM operation. Defaults to click."),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Params for action execution"),
  value: z.string().optional().describe("Value for set_value DOM operation"),
});

export const guiInspectAction = defineZodAction(
  {
    id: ACTION_ID.GUI_INSPECT,
    category: "app",
    description:
      "Inspect registered GUI actions and currently visible controls",
    params: GuiInspectParamsSchema,
    layer: "gui",
    tags: ["gui", "inspect", "manifest", "actions", "controls"],
    examples: [
      "what GUI controls are available",
      "find source control actions",
    ],
  },
  async ({ query }) => ({
    success: true,
    message: "Collected GUI manifest",
    data: buildGuiManifest(query),
  })
);

export const guiExecuteAction = defineZodAction(
  {
    id: ACTION_ID.GUI_EXECUTE,
    category: "app",
    description:
      "Execute a registered GUI action or operate on a visible DOM control",
    params: GuiExecuteParamsSchema,
    layer: "gui",
    tags: ["gui", "execute", "action", "dom", "click", "focus"],
    examples: ["click a visible control", "run a GUI action from the manifest"],
  },
  async ({
    targetKind,
    actionId,
    targetId,
    operation = "click",
    params,
    value,
  }) => {
    if (targetKind === "action") {
      if (!actionId) {
        return {
          success: false,
          message: "actionId is required for action targets",
        };
      }
      if (
        actionId === ACTION_ID.GUI_EXECUTE ||
        actionId === ACTION_ID.GUI_INSPECT
      ) {
        return {
          success: false,
          message: "GUI meta-actions cannot execute themselves",
        };
      }
      return zodActionRegistry.execute(actionId, params ?? {});
    }

    if (!targetId) {
      return {
        success: false,
        message: "targetId is required for DOM targets",
      };
    }

    const element = findDomControlElement(targetId);
    if (!element) {
      return {
        success: false,
        message: `DOM target ${targetId} is no longer visible`,
      };
    }
    if (isDisabled(element)) {
      return { success: false, message: `DOM target ${targetId} is disabled` };
    }

    element.scrollIntoView({
      block: "center",
      inline: "center",
      behavior: "smooth",
    });

    if (operation === "focus") {
      element.focus();
      return {
        success: true,
        message: `Focused ${getAccessibleName(element)}`,
      };
    }

    if (operation === "set_value") {
      if (typeof value !== "string") {
        return { success: false, message: "value is required for set_value" };
      }
      const changed = setNativeValue(element, value);
      return changed
        ? { success: true, message: `Set ${getAccessibleName(element)}` }
        : {
            success: false,
            message: `DOM target ${targetId} does not accept values`,
          };
    }

    element.click();
    return { success: true, message: `Clicked ${getAccessibleName(element)}` };
  }
);

export const guiControlZodActions = [guiInspectAction, guiExecuteAction];

export const guiControlActionRegistration =
  defineAppActionRegistration(guiControlZodActions);
