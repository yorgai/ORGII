/**
 * OutlineView Configuration
 *
 * Icons and constants for the outline view
 */
import {
  Box,
  Braces,
  Code,
  FileCode,
  FunctionSquare,
  Hash,
  Type,
  Variable,
} from "lucide-react";
import type { ComponentType } from "react";

import type { SymbolKind } from "./types";

/**
 * Icon configuration for different symbol kinds
 */
export const SYMBOL_ICONS: Record<
  SymbolKind,
  ComponentType<{ size?: string | number; className?: string }>
> = {
  function: FunctionSquare,
  class: Box,
  interface: Braces,
  type: Type,
  const: Variable,
  let: Variable,
  var: Variable,
  export: FileCode,
  import: FileCode,
  method: Code,
  property: Hash,
  enum: Braces,
};

/**
 * Color classes for different symbol kinds
 * Uses design system colors for proper light/dark theme support
 */
export const SYMBOL_COLORS: Record<SymbolKind, string> = {
  function: "text-primary-6",
  class: "text-warning-6",
  interface: "text-primary-6",
  type: "text-purple-6",
  const: "text-success-6",
  let: "text-success-6",
  var: "text-success-6",
  export: "text-warning-5",
  import: "text-warning-5",
  method: "text-primary-5",
  property: "text-text-2",
  enum: "text-danger-6",
};

/**
 * Display names for symbol kinds
 */
export const SYMBOL_LABELS: Record<SymbolKind, string> = {
  function: "Function",
  class: "Class",
  interface: "Interface",
  type: "Type",
  const: "Constant",
  let: "Variable",
  var: "Variable",
  export: "Export",
  import: "Import",
  method: "Method",
  property: "Property",
  enum: "Enum",
};
