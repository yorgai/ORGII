/**
 * ORGII Project Format Types
 *
 * Type definitions for .orgii.ts/.orgii.tsx project files.
 * Used for isolated component development ("Storybook for AI").
 *
 * @see Documentation/Architecture-Guide/orgii-editor/orgii-project-format-0130.md
 */
import type { ComponentType, ReactNode } from "react";

// ============================================
// Control Types
// ============================================

/** Control type for argTypes - determines what UI control is shown */
export type OrgiiControl =
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "multi-select"
  | "radio"
  | "color"
  | "date"
  | "object"
  | "array"
  | false; // Disable control

/** Arg type configuration for a single prop */
export interface OrgiiArgType<T = unknown> {
  /** Control type in props panel */
  control?: OrgiiControl;
  /** Options for select/radio controls */
  options?: T[];
  /** Mapping for option display names */
  mapping?: Record<string, T>;
  /** Description shown in props panel */
  description?: string;
  /** Default value (overrides component default) */
  defaultValue?: T;
  /** Mark as action (logs to console) */
  action?: string;
  /** Category for grouping in props panel */
  category?: string;
  /** Subcategory for nested grouping */
  subcategory?: string;
  /** Whether this arg is required */
  required?: boolean;
}

// ============================================
// Parameters
// ============================================

/** Viewport configuration for responsive preview */
export interface OrgiiViewport {
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Display label (e.g., "iPhone SE") */
  label?: string;
}

/** Background configuration */
export interface OrgiiBackground {
  name: string;
  value: string;
}

/** Project parameters for preview configuration */
export interface OrgiiParameters {
  /** Viewport override */
  viewport?: OrgiiViewport;
  /** Background options */
  backgrounds?: {
    default: string;
    values: OrgiiBackground[];
  };
  /** Layout mode */
  layout?: "centered" | "fullscreen" | "padded";
  /** Documentation settings */
  docs?: {
    description?: string;
    source?: {
      code?: string;
      language?: string;
    };
  };
  /** Custom parameters (extensible) */
  [key: string]: unknown;
}

// ============================================
// Context & Decorators
// ============================================

/** Project context passed to decorators and render functions */
export interface OrgiiContext<TArgs = Record<string, unknown>> {
  /** Current args (merged from meta + project + user input) */
  args: TArgs;
  /** Arg type definitions */
  argTypes: Record<string, OrgiiArgType>;
  /** Project parameters */
  parameters: OrgiiParameters;
  /** Current viewport dimensions */
  viewport: { width: number; height: number };
  /** Data from loaders */
  loaded: Record<string, unknown>;
  /** Project name */
  name: string;
  /** Project ID */
  id: string;
}

/** Decorator function that wraps project rendering */
export type OrgiiDecorator<TArgs = Record<string, unknown>> = (
  Project: ComponentType,
  context: OrgiiContext<TArgs>
) => ReactNode;

/** Loader function for async data fetching before render */
export type OrgiiLoader<TLoaded = Record<string, unknown>> = (
  context: Omit<OrgiiContext, "loaded">
) => Promise<TLoaded>;

// ============================================
// Meta (Default Export)
// ============================================

/** Meta configuration - the default export of a .orgii.tsx file */
export interface OrgiiMeta<TArgs = Record<string, unknown>> {
  /** The component to render (required) */
  component: ComponentType<TArgs>;

  /** Navigation path: "Category/Subcategory/Name" (required) */
  title: string;

  /** Default args applied to all projects */
  args?: Partial<TArgs>;

  /** Arg type overrides for props panel */
  argTypes?: Partial<Record<keyof TArgs, OrgiiArgType>>;

  /** Decorators applied to all projects (innermost first) */
  decorators?: OrgiiDecorator<TArgs>[];

  /** Loaders for async data */
  loaders?: OrgiiLoader[];

  /** Project parameters */
  parameters?: OrgiiParameters;

  /** Tags for filtering in sidebar */
  tags?: string[];

  /** Component description (overrides JSDoc) */
  description?: string;

  /** Subcomponents to document alongside main component */
  subcomponents?: Record<string, ComponentType<unknown>>;
}

// ============================================
// Project (Named Exports)
// ============================================

/** Play function context with canvas element */
export interface OrgiiPlayContext<
  TArgs = Record<string, unknown>,
> extends OrgiiContext<TArgs> {
  /** The DOM element containing the rendered project */
  canvasElement: HTMLElement;
}

/** Individual project configuration - named exports in a .orgii.tsx file */
export interface OrgiiProject<TArgs = Record<string, unknown>> {
  /** Props to pass to component (merged with meta.args) */
  args?: Partial<TArgs>;

  /** Custom render function for complex layouts */
  render?: (args: TArgs, context: OrgiiContext<TArgs>) => ReactNode;

  /** Arg type overrides (merged with meta.argTypes) */
  argTypes?: Partial<Record<keyof TArgs, OrgiiArgType>>;

  /** Project-specific decorators (applied after meta decorators) */
  decorators?: OrgiiDecorator<TArgs>[];

  /** Project-specific loaders */
  loaders?: OrgiiLoader[];

  /** Project parameters (merged with meta.parameters) */
  parameters?: OrgiiParameters;

  /** Display name (defaults to export name) */
  name?: string;

  /** Project description for documentation */
  description?: string;

  /** Tags for filtering */
  tags?: string[];

  /** Interaction test / play function */
  play?: (context: OrgiiPlayContext<TArgs>) => Promise<void> | void;
}

// ============================================
// Indexer Types (from Rust)
// ============================================

/** Project metadata extracted by the Rust indexer */
export interface IndexedProject {
  /** Export name (e.g., "Primary") */
  exportName: string;
  /** Display name (from project.name or export name) */
  name: string;
  /** Args extracted from project definition */
  args: Record<string, unknown>;
  /** Project description */
  description?: string;
  /** Tags */
  tags?: string[];
  /** Line number in source file */
  line: number;
}

/** Project file metadata extracted by the Rust indexer */
export interface IndexedProjectFile {
  /** Absolute file path */
  file: string;
  /** Meta configuration */
  meta: {
    /** Component import path */
    componentPath: string;
    /** Navigation title */
    title: string;
    /** Default args */
    defaultArgs: Record<string, unknown>;
    /** Description */
    description?: string;
    /** Tags */
    tags?: string[];
  };
  /** Individual projects */
  projects: IndexedProject[];
}

// ============================================
// Utility Types
// ============================================

/** Extract args type from a component */
export type ArgsOf<T> = T extends ComponentType<infer P> ? P : never;

/** Create a project with proper typing */
export function defineProject<TArgs>(
  project: OrgiiProject<TArgs>
): OrgiiProject<TArgs> {
  return project;
}

/** Create meta with proper typing */
export function defineMeta<TArgs>(meta: OrgiiMeta<TArgs>): OrgiiMeta<TArgs> {
  return meta;
}
