/**
 * Pure utility functions for API and Tauri call tracking.
 * Extracted from apiTracker.ts — no mutable state lives here.
 */
import { getLastHoveredElement } from "../core/error/componentIssueTracker/";

// ============================================================================
// Component info
// ============================================================================

/** Extract selector and label from the most recently hovered DOM element. */
export const getComponentInfo = () => {
  const element = getLastHoveredElement();
  if (!element) return { selector: undefined, label: undefined };

  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = Array.from(element.classList).filter(Boolean).slice(0, 3);
  const classStr = classes.length ? `.${classes.join(".")}` : "";
  const dataComponent = element.getAttribute("data-component");
  const componentStr = dataComponent ? ` [${dataComponent}]` : "";

  const selector = `${tagName}${id}${classStr}${componentStr}`;
  const label = dataComponent
    ? `data-component="${dataComponent}"`
    : element.id
      ? `id="${element.id}"`
      : classes.length
        ? `className="${classes.join(" ")}"`
        : `<${tagName}>`;

  return { selector, label };
};

// ============================================================================
// Stack filtering sets
// ============================================================================

/** React/axios internal function names to skip in stack traces. */
export const INTERNAL_FUNCTIONS = new Set([
  "get",
  "set",
  "axios",
  "request",
  "dispatchRequest",
  "xhrAdapter",
  "settle",
  "handleLoad",
  "promiseReactionJob",
  "mountReducer",
  "useReducer",
  "useAtomValue",
  "useAtom",
  "useSetAtom",
  "renderWithHooks",
  "mountIndeterminateComponent",
  "beginWork$1",
  "performUnitOfWork",
  "workLoopSync",
  "renderRootSync",
  "performConcurrentWorkOnRoot",
  "workLoop",
  "flushWork",
  "performWorkUntilDeadline",
  "updateReducer",
  "rerenderReducer",
  // API layer functions to skip
  "getApi",
  "postApi",
  "putApi",
  "patchApi",
  "deleteApi",
  "makeRequest",
  "makeDeleteRequest",
  "captureApiCallStack",
]);

/** Tauri internal function names to skip in stack traces. */
export const TAURI_INTERNAL_FUNCTIONS = new Set([
  "invokeTauri",
  "invoke",
  "trackTauriInvoke",
  ...INTERNAL_FUNCTIONS,
]);

// ============================================================================
// Stack trace parsers
// ============================================================================

/** Capture and filter a stack trace for HTTP API calls. */
export const getApiStack = (): string => {
  try {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");

    const relevantLines = lines
      .slice(2)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "@") return false;
        if (trimmed.includes("node_modules")) return false;
        if (trimmed.includes("apiTracker.ts")) return false;
        if (trimmed.includes("apiConfig.ts")) return false;
        if (trimmed.includes("axios")) return false;

        const funcMatch = trimmed.match(/^(\w+)@/);
        if (funcMatch && INTERNAL_FUNCTIONS.has(funcMatch[1])) return false;

        const chromeMatch = trimmed.match(/at\s+(\w+)\s*\(/);
        if (chromeMatch && INTERNAL_FUNCTIONS.has(chromeMatch[1])) return false;

        return true;
      })
      .slice(0, 5)
      .map((line) => line.trim());

    return relevantLines.join("\n");
  } catch {
    return "";
  }
};

/** Capture and filter a stack trace for Tauri invoke calls. */
export const getTauriStack = (): string => {
  try {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");

    const relevantLines = lines
      .slice(2)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "@") return false;
        if (trimmed.includes("node_modules")) return false;
        if (trimmed.includes("apiTracker.ts")) return false;
        if (trimmed.includes("tauri/init.ts")) return false;

        const funcMatch = trimmed.match(/^(\w+)@/);
        if (funcMatch && TAURI_INTERNAL_FUNCTIONS.has(funcMatch[1]))
          return false;

        const chromeMatch = trimmed.match(/at\s+(\w+)\s*\(/);
        if (chromeMatch && TAURI_INTERNAL_FUNCTIONS.has(chromeMatch[1]))
          return false;

        return true;
      })
      .slice(0, 5)
      .map((line) => line.trim());

    return relevantLines.join("\n");
  } catch {
    return "";
  }
};

// ============================================================================
// File info extraction
// ============================================================================

/** Parse file path, component name, function name, and line number from a stack trace. */
export const extractFileInfo = (stack: string) => {
  try {
    const lines = stack.split("\n");
    if (lines.length === 0) return {};

    const firstLine = lines[0];

    let functionOrComponentName: string | undefined;
    let filePath: string | undefined;
    let lineNumber: number | undefined;

    // Safari/Firefox format: "FunctionName@http://..."
    const safariMatch = firstLine.match(/^(\w+)@(.*)$/);
    if (safariMatch) {
      functionOrComponentName = safariMatch[1];
      const urlPart = safariMatch[2];
      if (urlPart) {
        const pathMatch = urlPart.match(
          /(?:https?:\/\/[^/]+\/)?(src\/[^:]+):(\d+):\d+/
        );
        if (pathMatch) {
          filePath = pathMatch[1];
          lineNumber = parseInt(pathMatch[2], 10);
        }
      }
    } else {
      // Chrome format
      const chromeNameMatch = firstLine.match(/at\s+(\w+)\s*\(/);
      if (chromeNameMatch) functionOrComponentName = chromeNameMatch[1];

      const chromePathMatch = firstLine.match(
        /(?:webpack-internal:\/\/\/\.)?(?:https?:\/\/[^/]+\/)?(src\/[^:)]+):(\d+):\d+/
      );
      if (chromePathMatch) {
        filePath = chromePathMatch[1];
        lineNumber = parseInt(chromePathMatch[2], 10);
      }
    }

    let componentName = functionOrComponentName;
    if (filePath) {
      const fileNameMatch = filePath.match(/\/([^/]+?)(?:\/index)?\.tsx?$/);
      if (fileNameMatch) componentName = fileNameMatch[1];
    }

    if (componentName || filePath) {
      return {
        filePath,
        componentName,
        functionName: functionOrComponentName,
        lineNumber,
      };
    }
    return {};
  } catch {
    return {};
  }
};

// ============================================================================
// ID generation
// ============================================================================

/** Generate a unique request ID. */
export const generateRequestId = (): string =>
  `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
