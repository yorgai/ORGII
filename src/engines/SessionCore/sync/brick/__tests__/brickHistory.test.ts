import { describe, expect, it, vi } from "vitest";

import {
  type BrickCommandResult,
  type BrickCommandRunner,
  BrickContractError,
  BrickHistoryClient,
  BrickUnavailableError,
  parseSessionsPage,
} from "../brickHistoryClient";
import {
  type OrgiiSessionRowForParity,
  compareSessionParity,
  runShadowReadParity,
} from "../brickShadowRead";

function ok(stdout: string): BrickCommandResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 1, timedOut: false };
}

function runnerReturning(stdout: string): BrickCommandRunner {
  return vi.fn(async () => ok(stdout));
}

const VERSION_JSON = JSON.stringify({
  name: "brick",
  version: "0.1.0",
  metadata_db_schema_version: 5,
  history_contract_version: 1,
});

const SESSIONS_JSON = JSON.stringify({
  source_id: "claude_code",
  limit: 20,
  offset: 0,
  total: 2,
  has_more: false,
  sessions: [
    {
      source_id: "claude_code",
      external_session_id: "abc",
      session_id: "claude_code:abc",
      title: "Investigate parser",
      input_tokens: 100,
      output_tokens: 50,
      touched_files: ["src/lib.rs"],
    },
    {
      source_id: "claude_code",
      external_session_id: "def",
      title: null,
      input_tokens: null,
      output_tokens: null,
      touched_files: [],
    },
  ],
});

describe("BrickHistoryClient.version", () => {
  it("parses version info and passes array args", async () => {
    const run = runnerReturning(VERSION_JSON);
    const client = new BrickHistoryClient(run);
    const info = await client.version();
    expect(info.historyContractVersion).toBe(1);
    expect(info.metadataDbSchemaVersion).toBe(5);
    expect(run).toHaveBeenCalledWith(
      ["version", "--format", "json"],
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    );
  });

  it("isCompatible is true for supported contract version", async () => {
    const client = new BrickHistoryClient(runnerReturning(VERSION_JSON));
    expect(await client.isCompatible()).toBe(true);
  });

  it("isCompatible is false when binary errors", async () => {
    const run: BrickCommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "boom",
      exitCode: 127,
      durationMs: 1,
      timedOut: false,
    }));
    const client = new BrickHistoryClient(run);
    expect(await client.isCompatible()).toBe(false);
  });
});

describe("BrickHistoryClient.sessions", () => {
  it("parses a sessions page with nullable fields", async () => {
    const client = new BrickHistoryClient(runnerReturning(SESSIONS_JSON));
    const page = await client.sessions("claude_code", { limit: 20 });
    expect(page.total).toBe(2);
    expect(page.sessions[0].externalSessionId).toBe("abc");
    expect(page.sessions[0].inputTokens).toBe(100);
    expect(page.sessions[1].title).toBeNull();
  });

  it("throws BrickUnavailableError on non-zero exit", async () => {
    const run: BrickCommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "nope",
      exitCode: 1,
      durationMs: 1,
      timedOut: false,
    }));
    const client = new BrickHistoryClient(run);
    await expect(client.sessions("claude_code")).rejects.toBeInstanceOf(
      BrickUnavailableError
    );
  });

  it("throws BrickContractError when sessions array is missing", () => {
    expect(() => parseSessionsPage({ source_id: "x" })).toThrow(
      BrickContractError
    );
  });
});

describe("compareSessionParity", () => {
  const brick = parseSessionsPage(JSON.parse(SESSIONS_JSON)).sessions;

  it("reports ok when rows match", () => {
    const orgii: OrgiiSessionRowForParity[] = [
      {
        externalSessionId: "abc",
        title: "Investigate parser",
        totalTokens: 150,
      },
      { externalSessionId: "def", title: null, totalTokens: null },
    ];
    const report = compareSessionParity("claude_code", brick, orgii);
    expect(report.ok).toBe(true);
    expect(report.matchedCount).toBe(2);
  });

  it("flags missing and mismatched rows", () => {
    const orgii: OrgiiSessionRowForParity[] = [
      { externalSessionId: "abc", title: "Different title", totalTokens: 999 },
      { externalSessionId: "ghi", title: "Only in ORGII", totalTokens: null },
    ];
    const report = compareSessionParity("claude_code", brick, orgii);
    expect(report.ok).toBe(false);
    const fields = report.mismatches.map((m) => m.field).sort();
    expect(fields).toContain("title");
    expect(fields).toContain("tokens");
    expect(fields).toContain("missing_in_brick");
    expect(fields).toContain("missing_in_orgii");
  });
});

describe("runShadowReadParity", () => {
  it("returns null when binary is incompatible", async () => {
    const run: BrickCommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 127,
      durationMs: 1,
      timedOut: false,
    }));
    const client = new BrickHistoryClient(run);
    const report = await runShadowReadParity(client, "claude_code", []);
    expect(report).toBeNull();
  });

  it("returns a parity report when compatible", async () => {
    let call = 0;
    const run: BrickCommandRunner = vi.fn(async () => {
      call += 1;
      return ok(call === 1 ? VERSION_JSON : SESSIONS_JSON);
    });
    const client = new BrickHistoryClient(run);
    const report = await runShadowReadParity(client, "claude_code", [
      {
        externalSessionId: "abc",
        title: "Investigate parser",
        totalTokens: 150,
      },
      { externalSessionId: "def", title: null, totalTokens: null },
    ]);
    expect(report).not.toBeNull();
    expect(report?.ok).toBe(true);
  });
});
