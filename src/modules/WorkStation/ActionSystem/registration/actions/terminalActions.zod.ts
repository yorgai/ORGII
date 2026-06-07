/**
 * Terminal Actions (Zod-based)
 *
 * Actions for terminal operations using the new Zod schema system.
 * These provide single-source-of-truth definitions with:
 * - Runtime validation
 * - TypeScript type inference
 * - Automatic LLM schema generation
 *
 * Two execution modes:
 * - terminal.execute: Runs in visible PTY terminal (user sees output)
 * - terminal.exec: Runs as subprocess, captures stdout/stderr for programmatic use
 */
import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { TerminalService } from "@src/services/terminal";

// ============================================
// Terminal Actions
// ============================================

export const terminalExecute = defineZodAction(
  {
    id: ACTION_ID.TERMINAL_EXECUTE,
    category: "terminal",
    layer: "action",
    description:
      "Execute a command in the visible terminal (PTY). Output appears in the terminal panel but is not captured.",
    params: z.object({
      command: z
        .string()
        .min(1, "Command cannot be empty")
        .describe("Command to run (e.g., 'npm install', 'git status')"),
    }),
    requiresConfirmation: true,
    examples: [
      "run npm install",
      "execute git status",
      "run ls -la",
      "execute yarn build",
    ],
  },
  async ({ command }) => {
    try {
      await TerminalService.execute(command);
      return {
        success: true,
        message: `Executed: ${command}`,
        data: { command, mode: "pty" },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
);

export const terminalExec = defineZodAction(
  {
    id: ACTION_ID.TERMINAL_EXEC,
    category: "terminal",
    layer: "action",
    description:
      "Execute a command as a subprocess and capture stdout/stderr. Does not show in the terminal panel. Use for programmatic output capture.",
    params: z.object({
      command: z
        .string()
        .min(1, "Command cannot be empty")
        .describe("Shell command to run (passed to sh -c)"),
      cwd: z.string().optional().describe("Working directory for the command"),
    }),
    requiresConfirmation: true,
    examples: [
      "exec npm test",
      "run command and capture output",
      "execute ls and get results",
    ],
  },
  async ({ command, cwd }) => {
    try {
      const result = await TerminalService.exec(command, cwd);
      const isSuccess = result.exitCode === 0;
      const outputText = result.stdout || result.stderr || "(no output)";

      return {
        success: isSuccess,
        message: isSuccess
          ? `Executed: ${command}`
          : `Command failed (exit ${result.exitCode}): ${command}`,
        data: {
          command,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          output: outputText,
          mode: "subprocess",
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
);

export const terminalFocus = defineZodAction(
  {
    id: ACTION_ID.TERMINAL_FOCUS,
    category: "terminal",
    description: "Show/focus the terminal panel",
    params: z.object({}),
    examples: ["open terminal", "show terminal", "focus terminal"],
  },
  async () => {
    TerminalService.focus();
    return { success: true, message: "Terminal focused" };
  }
);

export const terminalNew = defineZodAction(
  {
    id: ACTION_ID.TERMINAL_NEW,
    category: "terminal",
    description: "Create a new terminal session",
    params: z.object({
      shell: z.string().optional().describe("Shell executable path"),
      args: z.array(z.string()).optional().describe("Shell arguments"),
      name: z.string().optional().describe("Display name for the terminal"),
      profileId: z.string().optional().describe("Shell profile ID to use"),
    }),
    examples: ["new terminal", "create terminal tab", "open node terminal"],
  },
  async ({ shell, args, name, profileId }) => {
    const sessionId = TerminalService.createSession({
      shell,
      args,
      name,
      profileId,
    });
    return {
      success: true,
      message: "Created new terminal",
      data: { sessionId },
    };
  }
);

export const terminalClear = defineZodAction(
  {
    id: ACTION_ID.TERMINAL_CLEAR,
    category: "terminal",
    description: "Clear the terminal screen",
    params: z.object({}),
    examples: ["clear terminal"],
  },
  async () => {
    await TerminalService.clear();
    return { success: true, message: "Terminal cleared" };
  }
);

export const terminalKill = defineZodAction(
  {
    id: ACTION_ID.TERMINAL_KILL,
    category: "terminal",
    description: "Kill the current terminal process (Ctrl+C)",
    params: z.object({}),
    examples: ["kill terminal", "stop process", "cancel command"],
  },
  async () => {
    await TerminalService.kill();
    return { success: true, message: "Process killed" };
  }
);

export const terminalClose = defineZodAction(
  {
    id: ACTION_ID.TERMINAL_CLOSE,
    category: "terminal",
    description: "Close a terminal session",
    params: z.object({
      sessionId: z
        .string()
        .optional()
        .describe("Session ID to close (defaults to active session)"),
    }),
    examples: ["close terminal", "close this terminal"],
  },
  async ({ sessionId }) => {
    const id = sessionId || TerminalService.getActiveSessionId();
    if (id) {
      await TerminalService.closeSession(id);
      return { success: true, message: "Terminal closed" };
    }
    return { success: false, message: "No terminal to close" };
  }
);

export const terminalSetActive = defineZodAction(
  {
    id: ACTION_ID.TERMINAL_SET_ACTIVE,
    category: "terminal",
    description: "Switch to a specific terminal session",
    params: z.object({
      sessionId: z.string().describe("Session ID to activate"),
    }),
    examples: ["switch terminal", "switch to terminal 2"],
  },
  async ({ sessionId }) => {
    TerminalService.setActive(sessionId);
    TerminalService.focus();
    return { success: true, message: "Terminal activated" };
  }
);

export const terminalRename = defineZodAction(
  {
    id: ACTION_ID.TERMINAL_RENAME,
    category: "terminal",
    description: "Rename a terminal session",
    params: z.object({
      sessionId: z
        .string()
        .optional()
        .describe("Session ID to rename (defaults to active session)"),
      title: z.string().min(1).describe("New display name"),
    }),
    examples: ["rename terminal to Dev Server", "rename this terminal"],
  },
  async ({ sessionId, title }) => {
    const targetId = sessionId || TerminalService.getActiveSessionId();
    if (!targetId) {
      return { success: false, message: "No terminal to rename" };
    }
    TerminalService.renameSession(targetId, title);
    return { success: true, message: `Terminal renamed to "${title}"` };
  }
);

// ============================================
// Export all terminal actions as array
// ============================================

export const terminalZodActions = [
  terminalExecute,
  terminalExec,
  terminalFocus,
  terminalNew,
  terminalClear,
  terminalKill,
  terminalClose,
  terminalSetActive,
  terminalRename,
];
