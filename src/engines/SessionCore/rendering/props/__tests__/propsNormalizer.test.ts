import { afterEach, describe, expect, it, vi } from "vitest";

import {
  makeChatInput,
  makeSimulatorInput,
  makeTrajectoryInput,
} from "@src/engines/SessionCore/rendering/props/__tests__/fixtures";

import { type RawEventInput, normalizeEventProps } from "../propsNormalizer";

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeEventProps", () => {
  // ============================================
  // Null / empty handling
  // ============================================

  describe("null/empty handling", () => {
    it("returns null for null input", () => {
      const output = normalizeEventProps(
        null as unknown as RawEventInput,
        "tool_call"
      );
      expect(output).toBeNull();
    });

    it("returns null for undefined input", () => {
      const output = normalizeEventProps(
        undefined as unknown as RawEventInput,
        "tool_call"
      );
      expect(output).toBeNull();
    });
  });

  // ============================================
  // Context detection
  // ============================================

  describe("context detection", () => {
    it("detects chat context when input has activity field", () => {
      const input = makeChatInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output).not.toBeNull();
      expect(output!.context).toBe("chat");
      expect(output!.variant).toBe("chat");
    });

    it("detects simulator context when input has event_id but no activity", () => {
      const input = makeSimulatorInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output).not.toBeNull();
      expect(output!.context).toBe("simulator");
      expect(output!.variant).toBe("simulator");
    });

    it("detects trajectory context when input has onSelect function", () => {
      const input = makeTrajectoryInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output).not.toBeNull();
      expect(output!.context).toBe("trajectory");
      expect(output!.variant).toBe("simulator");
    });

    it("uses explicit context override even with activity field present", () => {
      const input = makeChatInput(
        {},
        { context: "simulator" }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output).not.toBeNull();
      expect(output!.context).toBe("simulator");
    });

    it("uses explicit variant override even with activity field present", () => {
      const input = makeChatInput(
        {},
        { variant: "simulator" }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output).not.toBeNull();
      expect(output!.variant).toBe("simulator");
      expect(output!.context).toBe("chat");
    });

    it("falls back to simulator when no context hints exist", () => {
      const input = {
        function: "read_file",
        args: {},
        result: {},
      } as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output).not.toBeNull();
      expect(output!.context).toBe("simulator");
      expect(output!.variant).toBe("simulator");
    });

    it("trajectory variant is simulator even without explicit variant", () => {
      const selectHandler = () => {};
      const input = makeTrajectoryInput({
        onSelect: selectHandler,
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output).not.toBeNull();
      expect(output!.context).toBe("trajectory");
      expect(output!.variant).toBe("simulator");
      expect(output!.onSelect).toBe(selectHandler);
    });

    it("preserves isSelected from trajectory input", () => {
      const input = makeTrajectoryInput({
        isSelected: true,
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output).not.toBeNull();
      expect(output!.isSelected).toBe(true);
    });
  });

  // ============================================
  // Status mapping
  // ============================================

  describe("status mapping", () => {
    it('maps "success" to "success"', () => {
      const input = makeChatInput({
        status: "success",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("success");
    });

    it('maps "completed" to "success"', () => {
      const input = makeChatInput({
        status: "completed",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("success");
    });

    it('maps "verified" to "success"', () => {
      const input = makeChatInput({
        status: "verified",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("success");
    });

    it('maps "fail" to "failed"', () => {
      const input = makeChatInput({
        status: "fail",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("failed");
    });

    it('maps "failed" to "failed"', () => {
      const input = makeChatInput({
        status: "failed",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("failed");
    });

    it('maps "error" to "failed"', () => {
      const input = makeChatInput({
        status: "error",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("failed");
    });

    it('maps "pending" to "pending"', () => {
      const input = makeChatInput({
        status: "pending",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("pending");
    });

    it('maps "waiting" to "pending"', () => {
      const input = makeChatInput({
        status: "waiting",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("pending");
    });

    it('maps "cancel" to "cancelled"', () => {
      const input = makeChatInput({
        status: "cancel",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("cancelled");
    });

    it('maps "cancelled" to "cancelled"', () => {
      const input = makeChatInput({
        status: "cancelled",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("cancelled");
    });

    it('maps null displayStatus to "running"', () => {
      const input = makeChatInput({
        displayStatus: null,
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("running");
    });

    it('maps empty displayStatus to "running"', () => {
      const input = makeChatInput({
        displayStatus: "",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("running");
    });

    it("default displayStatus (completed) maps to success", () => {
      const input = makeChatInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("success");
    });

    it("uses last element of array status", () => {
      const input = makeSimulatorInput({
        status: ["running", "completed"],
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("success");
    });

    it("uses last element of array status when last is failed", () => {
      const input = makeSimulatorInput({
        status: ["running", "failed"],
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("failed");
    });

    it('handles mixed case "Success" -> "success"', () => {
      const input = makeChatInput({
        status: "Success",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("success");
    });

    it('handles uppercase "FAILED" -> "failed"', () => {
      const input = makeChatInput({
        status: "FAILED",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("failed");
    });

    it("reads status from activity.status field", () => {
      const input = makeChatInput({
        status: "success",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("success");
    });

    it("reads status from input.status field for simulator format", () => {
      const input = makeSimulatorInput({
        status: "failed",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("failed");
    });

    it('handles "PENDING" uppercase -> "pending"', () => {
      const input = makeSimulatorInput({
        status: "PENDING",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("pending");
    });

    it('handles "Cancelled" mixed case -> "cancelled"', () => {
      const input = makeSimulatorInput({
        status: "Cancelled",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.status).toBe("cancelled");
    });
  });

  describe("shell process state", () => {
    it("preserves shell process state from chat session events", () => {
      const input = makeChatInput({
        shellPid: 12345,
        shellProcessStatus: "background",
        shellExitCode: 0,
        shellLogPath: "/tmp/orgii-shell.log",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "run_shell");

      expect(output!.shellPid).toBe(12345);
      expect(output!.shellProcessStatus).toBe("background");
      expect(output!.shellExitCode).toBe(0);
      expect(output!.shellLogPath).toBe("/tmp/orgii-shell.log");
    });

    it("preserves snake-case shell process state from flat events", () => {
      const input = makeSimulatorInput({
        shell_pid: 12345,
        shell_process_status: "running",
        shell_exit_code: 0,
        shell_log_path: "/tmp/orgii-shell.log",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "run_shell");

      expect(output!.shellPid).toBe(12345);
      expect(output!.shellProcessStatus).toBe("running");
      expect(output!.shellExitCode).toBe(0);
      expect(output!.shellLogPath).toBe("/tmp/orgii-shell.log");
    });
  });

  describe("active event painting freshness", () => {
    it("keeps active painting for running events created within 30 minutes", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-28T06:00:00.000Z"));

      const input = makeChatInput({
        status: "running",
        createdAt: "2026-05-28T05:31:00.000Z",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");

      expect(output!.status).toBe("running");
      expect(output!.showActiveEventPainting).toBe(true);
    });

    it("turns off active painting for running events older than 30 minutes", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-28T06:00:00.000Z"));

      const input = makeChatInput({
        status: "running",
        createdAt: "2026-05-28T05:29:59.000Z",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");

      expect(output!.status).toBe("running");
      expect(output!.showActiveEventPainting).toBe(false);
    });

    it("does not paint completed events as active", () => {
      const input = makeChatInput({
        status: "completed",
        createdAt: new Date().toISOString(),
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");

      expect(output!.status).toBe("success");
      expect(output!.showActiveEventPainting).toBe(false);
    });
  });

  // ============================================
  // Event ID extraction
  // ============================================

  describe("event ID extraction", () => {
    it("extracts eventId from activity.chunk_id (primary)", () => {
      const input = makeChatInput({
        chunk_id: "chunk-primary-001",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.eventId).toBe("chunk-primary-001");
    });

    it("extracts eventId from rawData.chunk_id when activity is absent", () => {
      const input = makeSimulatorInput({
        chunk_id: "chunk-raw-002",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.eventId).toBe("chunk-raw-002");
    });

    it("extracts eventId from input.chunk_id as fallback", () => {
      const input = {
        chunk_id: "chunk-input-003",
        function: "read_file",
        args: {},
        result: {},
      } as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.eventId).toBe("chunk-input-003");
    });

    it("returns empty string when all chunk_id sources are missing", () => {
      const input = {
        function: "read_file",
        args: {},
        result: {},
      } as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.eventId).toBe("");
    });

    it("uses chunk_id from simulator format", () => {
      const input = makeSimulatorInput({
        chunk_id: "chunk-sim-004",
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.eventId).toBe("chunk-sim-004");
    });

    it("prefers activity.chunk_id over input.chunk_id", () => {
      const input = makeChatInput(
        { chunk_id: "from-activity" },
        { chunk_id: "from-input" }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.eventId).toBe("from-activity");
    });

    it("uses default chunk_id from makeChatInput fixture", () => {
      const input = makeChatInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.eventId).toBe("chunk-chat-001");
    });
  });

  // ============================================
  // Args and result extraction
  // ============================================

  describe("args and result extraction", () => {
    it("extracts args from chat activity via normalizeActivity", () => {
      const input = makeChatInput({
        args: { file_path: "src/test.ts" },
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.args).toEqual({ file_path: "src/test.ts" });
    });

    it("extracts result from chat activity via normalizeActivity", () => {
      const input = makeChatInput({
        result: { output: { success: { content: "file contents" } } },
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.result).toEqual({
        output: { success: { content: "file contents" } },
      });
    });

    it("extracts args from simulator direct props via normalizeActivity", () => {
      const input = makeSimulatorInput({
        args: { command: "npm test" },
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.args).toEqual({ command: "npm test" });
    });

    it("extracts result from simulator direct props via normalizeActivity", () => {
      const input = makeSimulatorInput({
        result: { status: "ok", data: 42 },
      }) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.result).toEqual({ status: "ok", data: 42 });
    });

    it("returns empty objects for args/result when both are absent", () => {
      const input = {
        function: "read_file",
      } as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.args).toEqual({});
      expect(output!.result).toEqual({});
    });
  });

  // ============================================
  // Animation config
  // ============================================

  describe("animation config", () => {
    it("builds animation config when enableTypewriter is true", () => {
      const input = makeChatInput(
        {},
        { enableTypewriter: true }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.animation).toBeDefined();
      expect(output!.animation!.enableTypewriter).toBe(true);
    });

    it("builds animation config when enableAutoScroll is true", () => {
      const input = makeChatInput(
        {},
        { enableAutoScroll: true }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.animation).toBeDefined();
      expect(output!.animation!.enableAutoScroll).toBe(true);
    });

    it("animation is undefined when both flags are false", () => {
      const input = makeChatInput(
        {},
        { enableTypewriter: false, enableAutoScroll: false }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.animation).toBeUndefined();
    });

    it("animation is undefined when both flags are absent", () => {
      const input = makeChatInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.animation).toBeUndefined();
    });

    it("passes through typewriterConfig", () => {
      const typewriterConfig = {
        lineByLine: true,
        linesPerFrame: 3,
        frameInterval: 50,
      };
      const input = makeChatInput(
        {},
        { enableTypewriter: true, typewriterConfig }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.animation!.typewriterConfig).toEqual(typewriterConfig);
    });

    it("passes through autoScrollConfig", () => {
      const autoScrollConfig = {
        pixelsPerFrame: 5,
        frameInterval: 16,
        initialDelay: 100,
      };
      const input = makeChatInput(
        {},
        { enableAutoScroll: true, autoScrollConfig }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.animation!.autoScrollConfig).toEqual(autoScrollConfig);
    });

    it("passes through autoScrollLoop", () => {
      const input = makeChatInput(
        {},
        { enableAutoScroll: true, autoScrollLoop: true }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.animation!.autoScrollLoop).toBe(true);
    });

    it("builds full animation config with all options", () => {
      const typewriterConfig = { lineByLine: true, linesPerFrame: 2 };
      const autoScrollConfig = { pixelsPerFrame: 10 };
      const input = makeChatInput(
        {},
        {
          enableTypewriter: true,
          typewriterConfig,
          enableAutoScroll: true,
          autoScrollConfig,
          autoScrollLoop: false,
        }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.animation).toEqual({
        enableTypewriter: true,
        typewriterConfig,
        enableAutoScroll: true,
        autoScrollConfig,
        autoScrollLoop: false,
      });
    });
  });

  // ============================================
  // Streaming props
  // ============================================

  describe("streaming props", () => {
    it("passes through streamingContent", () => {
      const input = makeChatInput(
        {},
        { streamingContent: "partial output..." }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.streamingContent).toBe("partial output...");
    });

    it("passes through isStreaming", () => {
      const input = makeChatInput(
        {},
        { isStreaming: true }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.isStreaming).toBe(true);
    });

    it("passes through itemIndex", () => {
      const input = makeChatInput(
        {},
        { itemIndex: 7 }
      ) as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.itemIndex).toBe(7);
    });

    it("streaming fields are undefined when not provided", () => {
      const input = makeChatInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "tool_call");
      expect(output!.streamingContent).toBeUndefined();
      expect(output!.isStreaming).toBeUndefined();
      expect(output!.itemIndex).toBeUndefined();
    });
  });

  // ============================================
  // EventType passthrough
  // ============================================

  describe("eventType passthrough", () => {
    it("passes eventType parameter directly to output", () => {
      const input = makeChatInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "read_file");
      expect(output!.eventType).toBe("read_file");
    });

    it("passes custom eventType string to output", () => {
      const input = makeSimulatorInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "thinking");
      expect(output!.eventType).toBe("thinking");
    });

    it("passes empty eventType string to output", () => {
      const input = makeChatInput() as unknown as RawEventInput;
      const output = normalizeEventProps(input, "");
      expect(output!.eventType).toBe("");
    });
  });
});
