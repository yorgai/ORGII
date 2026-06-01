/**
 * ANSI Processing Utilities
 *
 * Extracted from RunCommand and TerminalBlock to eliminate duplication.
 * Handles ANSI escape sequences and terminal control codes.
 */

/**
 * Process ANSI content for clean display
 * Strips cursor control sequences while preserving color codes
 *
 * @param content - Raw terminal output with ANSI codes
 * @returns Cleaned content ready for ansi-to-react
 */
export function processAnsiContent(content: string): string {
  if (!content || typeof content !== "string") return "";

  return (
    content
      // Normalize line endings
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Remove cursor positioning codes (ESC[nG - move to column n)
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9]*[GK]/g, "")
      // Remove cursor up codes (ESC[nA - move up n lines)
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9]*[A]/g, "")
  );
}

/**
 * Strip all ANSI escape codes (for plain text output)
 *
 * @param content - Terminal output with ANSI codes
 * @returns Plain text without any ANSI codes
 */
export function stripAnsiCodes(content: string): string {
  if (!content || typeof content !== "string") return "";

  // Remove all ANSI escape sequences
  // eslint-disable-next-line no-control-regex
  return content.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Check if content contains ANSI codes
 *
 * @param content - Content to check
 * @returns True if content has ANSI escape sequences
 */
export function hasAnsiCodes(content: string): boolean {
  if (!content || typeof content !== "string") return false;

  // eslint-disable-next-line no-control-regex
  return /\u001b\[[0-9;]*[a-zA-Z]/.test(content);
}
