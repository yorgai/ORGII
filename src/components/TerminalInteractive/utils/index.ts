/**
 * Terminal View Utilities
 */

export { writeBrowserModeMessage } from "./browserModeMessage";
export { createTerminalFileLinks, resolveTerminalFilePath } from "./fileLinks";
export {
  ANSI_DIM,
  ANSI_RED,
  ANSI_RESET,
  formatSystemChunk,
} from "./shellOutputFormat";
export { getBgColor, getXTermTheme } from "./theme";
