/**
 * OutlineView Types
 *
 * Types for the symbol outline/tree view
 */

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "let"
  | "var"
  | "export"
  | "import"
  | "method"
  | "property"
  | "enum";

export interface OutlineSymbol {
  /** Unique identifier for the symbol */
  id: string;
  /** Symbol name */
  name: string;
  /** Symbol kind (function, class, etc.) */
  kind: SymbolKind;
  /** Line number where symbol starts */
  line: number;
  /** Column number where symbol starts */
  column: number;
  /** Line number where symbol ends (for tree building) */
  endLine: number;
  /** Column number where symbol ends */
  endColumn: number;
  /** Child symbols (methods, properties, etc.) */
  children: OutlineSymbol[];
  /** Whether the symbol is expanded in the tree */
  expanded: boolean;
}
