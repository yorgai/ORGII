// Production BrickCommandRunner backed by the Tauri shell plugin.
//
// Bridges the typed `BrickHistoryClient` to the real `brick` binary. Arguments
// are passed as positional parameters to `sh` (never interpolated into a command
// string) so no shell metacharacter in a source id or session id can escape
// into the command line — this satisfies the adapter contract's
// "array args, no injection" requirement while reusing the already-allowlisted
// `sh` entry in src-tauri/capabilities/default.json.
import { Command } from "@tauri-apps/plugin-shell";

import { createLogger } from "@src/hooks/logger";

import type {
  BrickCommandResult,
  BrickCommandRunner,
} from "./brickHistoryClient";

const logger = createLogger("TauriBrickRunner");

/** Binary name resolved from PATH unless overridden. */
const DEFAULT_BRICK_BIN = "brick";

/**
 * Builds a runner that executes `brick <args...>` via the Tauri shell plugin.
 *
 * `sh -c 'exec "$0" "$@"' <bin> <args...>` runs the binary with each arg as a
 * separate, unparsed positional parameter. `exec` replaces the shell so the
 * exit code is the binary's own.
 */
export function createTauriBrickRunner(
  brickBin: string = DEFAULT_BRICK_BIN
): BrickCommandRunner {
  return async (
    args: string[],
    options: { timeoutMs: number }
  ): Promise<BrickCommandResult> => {
    const startedAt = Date.now();
    const shellArgs = ["-c", 'exec "$0" "$@"', brickBin, ...args];
    const command = Command.create("sh", shellArgs);

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const output = await new Promise<{
        code: number | null;
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error("brick command timed out"));
        }, options.timeoutMs);

        command.execute().then(resolve, reject);
      });

      return {
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: output.code,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      };
    } catch (error) {
      if (timedOut) {
        return {
          stdout: "",
          stderr: "brick command timed out",
          exitCode: null,
          durationMs: Date.now() - startedAt,
          timedOut: true,
        };
      }
      logger.warn("brick command failed to spawn", { args, error });
      return {
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
