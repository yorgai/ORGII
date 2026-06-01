import type { StatusPreset } from "../../types";

export const commandRunShellPresets: Record<string, StatusPreset[]> = {
  run: [
    {
      key: "success",
      label: "Success (exit 0)",
      status: "completed",
      resultPatch: { exit_code: 0, execution_time: 22140 },
      argsPatch: {
        action: "run",
        kill_handle: undefined,
        shellProcessStatus: null,
        shellPid: null,
        streamOutput: null,
      },
    },
    {
      key: "running",
      label: "Running",
      status: "running",
      resultPatch: {
        status: "running",
        exit_code: null,
        output: null,
        execution_time: 14320,
        success: null,
      },
      argsPatch: {
        action: "run",
        kill_handle: undefined,
        shellProcessStatus: "running",
        shellPid: 48201,
        streamOutput:
          "Compiling orgii-app v0.0.0 ...\n    Checking 14/38 crates ...",
      },
    },
    {
      key: "background",
      label: "Background (running)",
      status: "running",
      resultPatch: {
        status: "running",
        exit_code: null,
        output: null,
        execution_time: 182400,
        success: null,
      },
      argsPatch: {
        action: "run",
        kill_handle: undefined,
        shellProcessStatus: "background",
        shellPid: 48201,
        streamOutput: "watching for changes...",
      },
    },
    {
      // Explicit-mode backgrounded state AFTER tool_result arrives.
      // tool_result delivered `status: "succeeded"` (the spawn ack), but the
      // process is still very much alive — `shellProcessStatus: "background"`
      // keeps the chat block expanded with a "background · PID N" chip and
      // the Stop button reachable.
      key: "background-acked",
      label: "Background (acked, still alive)",
      status: "completed",
      resultPatch: {
        status: "succeeded",
        exit_code: null,
        output:
          "(running in background)\n\n[process started in background as PID 48201]\nLog file: /tmp/orgii-shell-48201.log",
        execution_time: 12,
        success: true,
      },
      argsPatch: {
        action: "run",
        mode: "background",
        kill_handle: undefined,
        shellProcessStatus: "background",
        shellPid: 48201,
        shellLogPath: "/tmp/orgii-shell-48201.log",
        streamOutput: null,
      },
    },
    {
      key: "exit-error",
      label: "Error (exit 1)",
      status: "completed",
      resultPatch: {
        exit_code: 1,
        execution_time: 3420,
        output:
          "src/api/client.ts:45:3 - error TS2322: Type 'string' is not assignable to type 'number'.\n\n45   timeout: \"30000\",\n     ~~~~~~~\n\nFound 1 error.",
      },
      argsPatch: {
        action: "run",
        kill_handle: undefined,
        shellProcessStatus: null,
        shellPid: null,
        streamOutput: null,
      },
    },
    {
      key: "denied",
      label: "Denied by user",
      status: "failed",
      resultPatch: {
        exit_code: null,
        output: "Error: Tool 'run_shell' was denied by the user",
        execution_time: null,
      },
      argsPatch: {
        action: "run",
        kill_handle: undefined,
        shellProcessStatus: null,
        shellPid: null,
        streamOutput: null,
      },
    },
    {
      key: "failed",
      label: "Failed (no output)",
      status: "failed",
      resultPatch: { exit_code: null, output: null, execution_time: null },
      argsPatch: {
        action: "run",
        kill_handle: undefined,
        shellProcessStatus: null,
        shellPid: null,
        streamOutput: null,
      },
    },
    {
      key: "killed",
      label: "Killed",
      status: "completed",
      resultPatch: { exit_code: 137, execution_time: 61200 },
      argsPatch: {
        action: "run",
        kill_handle: undefined,
        shellProcessStatus: "killed",
        shellPid: 48201,
        streamOutput: null,
      },
    },
  ],
  kill: [
    {
      key: "pending",
      label: "Killing...",
      status: "running",
      resultPatch: { message: undefined, success: undefined },
      argsPatch: {
        action: "kill",
        kill_handle: "bg_3",
        command: undefined,
        shellProcessStatus: null,
        shellPid: null,
        streamOutput: null,
      },
    },
    {
      key: "killed",
      label: "Killed",
      status: "completed",
      resultPatch: { success: true, message: "killed" },
      argsPatch: {
        action: "kill",
        kill_handle: "bg_3",
        command: undefined,
        shellProcessStatus: null,
        shellPid: null,
        streamOutput: null,
      },
    },
    {
      key: "already-exited",
      label: "Already exited",
      status: "completed",
      resultPatch: { success: true, message: "already exited" },
      argsPatch: {
        action: "kill",
        kill_handle: "bg_3",
        command: undefined,
        shellProcessStatus: null,
        shellPid: null,
        streamOutput: null,
      },
    },
    {
      key: "not-found",
      label: "Handle not found",
      status: "failed",
      resultPatch: {
        success: false,
        message: 'No background job with handle "bg_3"',
      },
      argsPatch: {
        action: "kill",
        kill_handle: "bg_3",
        command: undefined,
        shellProcessStatus: null,
        shellPid: null,
        streamOutput: null,
      },
    },
    {
      key: "failed",
      label: "Failed",
      status: "failed",
      resultPatch: {
        success: false,
        message: "SIGTERM ignored, SIGKILL failed",
      },
      argsPatch: {
        action: "kill",
        kill_handle: "bg_3",
        command: undefined,
        shellProcessStatus: null,
        shellPid: null,
        streamOutput: null,
      },
    },
  ],
};
