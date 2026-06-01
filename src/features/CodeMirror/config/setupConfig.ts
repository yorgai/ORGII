/**
 * CodeMirror BasicSetup Configurations
 *
 * Preset configurations for @uiw/react-codemirror's basicSetup prop.
 */

// ============================================
// Basic Setup Configuration
// ============================================

/**
 * Standard basicSetup configuration for full code editor
 */
export const BASIC_SETUP_CONFIG = {
  lineNumbers: true,
  highlightActiveLineGutter: true,
  highlightSpecialChars: true,
  foldGutter: false, // Disabled - using custom fold gutter
  drawSelection: true,
  dropCursor: true,
  allowMultipleSelections: true,
  indentOnInput: true,
  syntaxHighlighting: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: true,
  rectangularSelection: true,
  crosshairCursor: true,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  closeBracketsKeymap: true,
  defaultKeymap: true,
  searchKeymap: false, // Disabled - using custom find/replace
  historyKeymap: true,
  foldKeymap: true,
  completionKeymap: true,
  lintKeymap: true,
} as const;

/**
 * Minimal basicSetup for SQL editor and simple editors.
 * Simpler than BASIC_SETUP_CONFIG - no fold gutter, no search panel.
 */
export const BASIC_SETUP_SQL_CONFIG = {
  lineNumbers: true,
  foldGutter: false,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  autocompletion: true,
  bracketMatching: true,
  closeBrackets: true,
  indentOnInput: true,
} as const;
