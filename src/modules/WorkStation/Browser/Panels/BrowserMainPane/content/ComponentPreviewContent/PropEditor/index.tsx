/**
 * PropEditor - Individual prop value editor
 * Renders different input types based on prop type
 */
import { type FC, memo } from "react";

import type { PropEditorProps } from "../types";

/**
 * Safely convert a value to a display string
 * Handles objects with __jsx__ and other complex types
 */
function valueToString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    // Handle JSX-like objects
    if ("__jsx__" in (val as Record<string, unknown>)) {
      return "<JSX Element>";
    }
    try {
      return JSON.stringify(val);
    } catch {
      return "[Object]";
    }
  }
  return String(val);
}

export const PropEditor: FC<PropEditorProps> = memo(
  ({ prop, value, onChange }) => {
    // Render different editor based on prop type
    const propType =
      typeof prop.prop_type === "object" && "type" in prop.prop_type
        ? prop.prop_type.type
        : "unknown";

    switch (propType) {
      case "string":
        return (
          <input
            type="text"
            value={valueToString(value) || valueToString(prop.default_value)}
            onChange={(event) => onChange(event.target.value)}
            placeholder={prop.name}
            className="w-full rounded border border-border-2 bg-pane-input px-2 py-1 text-xs text-text-1"
          />
        );

      case "number":
        return (
          <input
            type="number"
            value={(value as number) ?? prop.default_value ?? 0}
            onChange={(event) => onChange(Number(event.target.value))}
            className="w-full rounded border border-border-2 bg-pane-input px-2 py-1 text-xs text-text-1"
          />
        );

      case "boolean":
        return (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={(value as boolean) ?? prop.default_value ?? false}
              onChange={(event) => onChange(event.target.checked)}
              className="rounded border-border-2"
            />
            <span className="text-xs text-text-2">
              {value ? "true" : "false"}
            </span>
          </label>
        );

      case "string_literal": {
        const options =
          typeof prop.prop_type === "object" && "values" in prop.prop_type
            ? (prop.prop_type.values as string[])
            : [];
        return (
          <select
            value={
              valueToString(value) ||
              valueToString(prop.default_value) ||
              options[0] ||
              ""
            }
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded border border-border-2 bg-pane-input px-2 py-1 text-xs text-text-1"
          >
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      }

      default:
        return (
          <input
            type="text"
            value={valueToString(value) || valueToString(prop.default_value)}
            onChange={(event) => onChange(event.target.value)}
            placeholder={`${prop.name} (${prop.type_annotation})`}
            className="w-full rounded border border-border-2 bg-pane-input px-2 py-1 text-xs text-text-1"
          />
        );
    }
  }
);

PropEditor.displayName = "PropEditor";
