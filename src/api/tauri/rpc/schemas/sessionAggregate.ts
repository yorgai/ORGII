/**
 * Session Aggregate RPC Schemas
 *
 * Zod schemas for session_aggregate_list / session_get_aggregate_stats commands.
 * Rust source: src-tauri/src/agent_sessions/unified_stats/
 *
 * All Rust structs use #[serde(rename_all = "camelCase")], so field names
 * arrive as camelCase — no transform needed.
 */
import { z } from "zod/v4";

import {
  CliAgentTypeSchema,
  MergeStatusSchema,
  PriceTierSchema,
} from "./validation";

// ── Enums ──

/**
 * Wire category from Rust (cli | agent | os | remote_shared).
 * Transformed at parse time to `DispatchCategory` so consumers never see the
 * wire value — only the routing value used by the frontend.
 */
const WireCategorySchema = z
  .enum(["cli", "agent", "os", "remote_shared"])
  .transform((cat): "cli_agent" | "rust_agent" | "remote_shared_session" => {
    if (cat === "cli") return "cli_agent";
    if (cat === "remote_shared") return "remote_shared_session";
    return "rust_agent";
  });

const RemoteShareModeSchema = z.enum(["readonly"]);
const RemoteMirrorStatusSchema = z.enum([
  "connecting",
  "live",
  "disconnected",
  "ended",
]);

// Schema for wire validation only — canonical KeySource type lives in dispatchTypes.ts
const KeySourceSchema = z.enum(["own_key", "hosted_key"]);

// ── Filter input ──

export const SessionFilterInput = z.object({
  category: z.string().optional(),
  status: z.string().optional(),
  keySource: z.string().optional(),
  repoPath: z.string().optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  textQuery: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  activeOnly: z.boolean().optional(),
});

export const SessionAggregateListInput = z.object({
  filter: SessionFilterInput.optional(),
});

export const SessionGetAggregateStatsInput = z.object({
  sessionIds: z.array(z.string()).optional(),
  keySource: z.string().optional(),
});

/**
 * Input for `session_patch`.
 *
 * Mutation API for in-session field edits. Mirrors the Rust
 * `SessionPatch` struct one-to-one — see
 * `src-tauri/src/agent_sessions/unified_stats/patch.rs` for the
 * routing rules.
 *
 * Allowed fields are deliberately limited:
 *  - `name` — session display title, including generated Rust-agent titles.
 *  - `model` + optional `accountId` — atomic model+key swap (one user pick).
 *  - `agentExecMode` — ModePill click; legal for Rust-agent and CLI-agent sessions.
 *  - `draftText` (P3) — per-session unsent composer text. `null` = clear,
 *    string = set. Field absent = leave alone.
 *  - `replyTargetEventId` (P3) — per-session reply pin. Same three-state
 *    semantics as `draftText`.
 *
 * Three-state semantics (`draftText` / `replyTargetEventId`):
 *   field absent      → leave column alone
 *   field === null    → clear column to NULL (composer cleared / reply dismissed)
 *   field === string  → write that value
 * Mirrors the Rust `Option<Option<String>>` double-Option deserialize.
 *
 * Fields that are NOT mutable here on purpose (set at session create):
 *  - `keySource` (mis-billing risk if changed mid-session)
 *  - `cliAgentType` (CLI process already spawned)
 *  - `listingModel` (piggybacks on `model` for market sessions)
 */
export const SessionPatchInput = z.object({
  sessionId: z.string().min(1),
  patch: z
    .object({
      name: z.string().trim().min(1).optional(),
      model: z.string().optional(),
      accountId: z.string().optional(),
      agentExecMode: z.string().optional(),
      // `.nullable().optional()` is the zod equivalent of the Rust
      // `Option<Option<String>>`: undefined = leave alone, null = clear,
      // string = set.
      draftText: z.string().nullable().optional(),
      replyTargetEventId: z.string().nullable().optional(),
      // P5: tag list replacement (absent = leave alone, [] = clear all tags)
      tags: z.array(z.string()).optional(),
      // P5: pin toggle (absent = leave alone)
      pinned: z.boolean().optional(),
      filesChanged: z.number().optional(),
      linesAdded: z.number().optional(),
      linesRemoved: z.number().optional(),
    })
    .refine(
      (p) =>
        p.name !== undefined ||
        p.model !== undefined ||
        p.agentExecMode !== undefined ||
        p.draftText !== undefined ||
        p.replyTargetEventId !== undefined ||
        p.tags !== undefined ||
        p.pinned !== undefined ||
        p.filesChanged !== undefined ||
        p.linesAdded !== undefined ||
        p.linesRemoved !== undefined,
      { message: "session_patch: at least one field must be set" }
    )
    .refine((p) => !(p.accountId !== undefined && p.model === undefined), {
      message:
        "session_patch: accountId provided without model — pair them in the same call",
    }),
});

// ── Output schemas ──

export const SessionAggregateRecordSchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  category: WireCategorySchema,
  userInput: z.string().optional(),
  repoPath: z.string().optional(),
  repoName: z.string().optional(),
  branch: z.string().optional(),
  model: z.string().optional(),
  accountId: z.string().optional(),
  cliAgentType: CliAgentTypeSchema.optional(),
  keySource: KeySourceSchema,
  tier: PriceTierSchema.optional(),
  pid: z.number().int().nullable().optional(),
  totalTokens: z.number().int(),
  worktreePath: z.string().optional(),
  worktreeBranch: z.string().optional(),
  baseBranch: z.string().optional(),
  mergeStatus: MergeStatusSchema.optional(),
  background: z.boolean(),
  isActive: z.boolean(),
  displayLabel: z.string().optional(),
  parentSessionId: z.string().optional(),
  orgMemberId: z.string().optional(),
  agentOrgId: z.string().optional(),
  agentOrgName: z.string().optional(),
  agentDefinitionId: z.string().optional(),
  agentIconId: z.string().optional(),
  agentDisplayName: z.string().optional(),
  // Per-session exec mode picked via in-session ModePill. Undefined means
  // "user has never patched this session" — frontend falls back to
  // `creatorDefaultExecModeAtom` until the first `session_patch`. CLI
  // sessions always emit `undefined` (no mode concept). String (not
  // strict enum) so the wire format tolerates new modes added on the
  // Rust side without a coordinated frontend release.
  agentExecMode: z.string().optional(),
  // Per-session unsent draft text (P3). The chat composer mirrors this
  // into ComposerInput on session activation. Cleared on send. Persisted via
  // debounced `session_patch` calls — see `useSessionDraftField`.
  draftText: z.string().optional(),
  // Per-session reply target event id (P3). Set when the user clicks
  // "Reply" on a chat item; cleared when the banner is dismissed or the
  // message is sent. Persisted via `session_patch`.
  replyTargetEventId: z.string().optional(),
  // User-defined tags (P5). Empty array means no tags.
  tags: z.array(z.string()).default([]),
  // Whether the session is pinned to the top of the sidebar (P5).
  pinned: z.boolean().default(false),
  sourceSessionId: z.string().optional(),
  shareId: z.string().optional(),
  sourceCategory: WireCategorySchema.optional(),
  shareMode: RemoteShareModeSchema.optional(),
  mirrorStatus: RemoteMirrorStatusSchema.optional(),
  sourcePeerLabel: z.string().optional(),
  lastConnectedAt: z.string().optional(),
  endedAt: z.string().optional(),
});

export const CategoryStatsSchema = z
  .object({
    cli: z.number().int(),
    agent: z.number().int(),
    os: z.number().int().optional(),
    remoteShared: z.number().int().optional(),
  })
  .transform((raw) => ({
    cliAgent: raw.cli,
    rustAgent: raw.agent + (raw.os ?? 0),
    remoteSharedSession: raw.remoteShared ?? 0,
  }));

export const KeySourceStatsSchema = z.object({
  ownKey: z.number().int(),
  hostedKey: z.number().int(),
});

export const SessionStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
  byCategory: CategoryStatsSchema,
  byKeySource: KeySourceStatsSchema,
});

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionAggregateRecordSchema),
  stats: SessionStatsSchema,
});

export const AggregateStatsSchema = z.object({
  totalCostUsd: z.number(),
  totalTokensInput: z.number().int(),
  totalTokensOutput: z.number().int(),
  totalTokens: z.number().int(),
  ongoingCount: z.number().int(),
  completedCount: z.number().int(),
  failedCount: z.number().int(),
});

export type SessionFilter = z.input<typeof SessionFilterInput>;
export type SessionAggregateRecord = z.output<
  typeof SessionAggregateRecordSchema
>;
export type SessionListResponse = z.output<typeof SessionListResponseSchema>;
export type AggregateStats = z.output<typeof AggregateStatsSchema>;
export type SessionPatchPayload = z.input<typeof SessionPatchInput>;
