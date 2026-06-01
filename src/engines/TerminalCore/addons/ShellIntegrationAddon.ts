/**
 * ShellIntegrationAddon
 *
 * xterm.js addon that intercepts OSC 633 sequences emitted by our
 * shell integration scripts and converts them into typed callbacks.
 *
 * Protocol (subset of VS Code's OSC 633):
 *   A             — prompt start
 *   B             — command input start (after prompt)
 *   C             — command executed (user pressed Enter)
 *   D[;<exit>]    — command finished, optional exit code
 *   E[;<cmd>]     — explicit command line text
 *   P;<Key>=<Val> — property (Cwd, etc.)
 */
import type { IDisposable, ITerminalAddon, Terminal } from "@xterm/xterm";

// ============================================
// Types
// ============================================

export interface ShellIntegrationCallbacks {
  onPromptStart?: () => void;
  onCommandStart?: () => void;
  onCommandExecuted?: (commandLine: string | undefined) => void;
  onCommandFinished?: (exitCode: number) => void;
  onCwdChanged?: (cwd: string) => void;
}

type CommandPhase = "idle" | "prompt" | "input" | "running";

// ============================================
// Addon
// ============================================

export class ShellIntegrationAddon implements ITerminalAddon {
  private disposables: IDisposable[] = [];
  private callbacks: ShellIntegrationCallbacks;
  private phase: CommandPhase = "idle";
  private pendingCommandLine: string | undefined;
  private activated = false;

  constructor(callbacks: ShellIntegrationCallbacks) {
    this.callbacks = callbacks;
  }

  activate(terminal: Terminal): void {
    const handler = terminal.parser.registerOscHandler(633, (data: string) => {
      this.handleSequence(data);
      return false;
    });
    this.disposables.push(handler);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }

  get isActivated(): boolean {
    return this.activated;
  }

  get currentPhase(): CommandPhase {
    return this.phase;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private handleSequence(raw: string): void {
    this.activated = true;

    const semiIdx = raw.indexOf(";");
    const command = semiIdx === -1 ? raw : raw.slice(0, semiIdx);
    const params = semiIdx === -1 ? "" : raw.slice(semiIdx + 1);

    switch (command) {
      case "A":
        this.phase = "prompt";
        this.pendingCommandLine = undefined;
        this.callbacks.onPromptStart?.();
        break;

      case "B":
        this.phase = "input";
        this.callbacks.onCommandStart?.();
        break;

      case "C":
        this.phase = "running";
        this.callbacks.onCommandExecuted?.(this.pendingCommandLine);
        break;

      case "D": {
        const exitCode = params ? parseInt(params, 10) : 0;
        this.phase = "idle";
        this.callbacks.onCommandFinished?.(
          Number.isNaN(exitCode) ? 0 : exitCode
        );
        break;
      }

      case "E":
        this.pendingCommandLine = unescapeValue(params);
        break;

      case "P":
        this.handleProperty(params);
        break;
    }
  }

  private handleProperty(raw: string): void {
    const eqIdx = raw.indexOf("=");
    if (eqIdx === -1) return;

    const key = raw.slice(0, eqIdx);
    const value = unescapeValue(raw.slice(eqIdx + 1));

    switch (key) {
      case "Cwd":
        this.callbacks.onCwdChanged?.(value);
        break;
    }
  }
}

// ============================================
// Helpers
// ============================================

function unescapeValue(value: string): string {
  return value.replace(/\\x3b/g, ";").replace(/\\\\/g, "\\");
}
