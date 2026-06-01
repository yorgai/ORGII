// Styles
import "./index.scss";

/**
 * Terminal Components - Public Exports
 *
 * Shared primitives for terminal command and output display.
 * Consolidates logic from RunCommand, TerminalBlock, and TerminalCommandView.
 */

// Components
export { TerminalCommand } from "./TerminalCommand";
export type {
  TerminalCommandProps,
  TerminalCommandStopAction,
} from "./TerminalCommand";

export { TerminalOutput } from "./TerminalOutput";
export type { TerminalOutputProps } from "./TerminalOutput";

// Utilities
export {
  processAnsiContent,
  stripAnsiCodes,
  hasAnsiCodes,
} from "./utils/ansiProcessor";

export {
  formatDirectoryTree,
  getOutputAsString,
  extractCommandFromResult,
  removeBackticks,
  extractExitCode,
  extractStderr,
} from "./utils/outputFormatter";
