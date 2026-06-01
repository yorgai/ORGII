/**
 * Cursor IDE control — Tauri API wrappers.
 *
 * Drive a running Cursor.app instance over CDP by reaching into its
 * renderer-side workbench services (`composerService`,
 * `composerChatService`, `composerModesService`, `modelConfigService`,
 * `agentRepositoryService`, `glassActiveAgentService`) — *not* by
 * synthesizing keyboard events into the live editor.
 *
 * The Rust side spawns an *isolated* Cursor probe instance (separate
 * `--user-data-dir`) on first use so the user's main Cursor never
 * has to relaunch — see `src-tauri/crates/cursor-bridge/README.md`
 * for the full design rationale.
 *
 * Capability matrix:
 *   - `send` (with optional `targetAgentId`, headless by default)
 *      → composerChatService.submitChatMaybeAbortCurrent
 *   - `newComposer` (with optional `unifiedMode`)
 *      → composerService.createComposer
 *   - `route`
 *      → HBC.onSelectAgent (fallback: glassActiveAgentService)
 *   - `setModel` / `setMode`
 *      → modelConfigService / composerModesService (per-composer
 *        handle resolved via composerDataService.getComposerHandleById)
 *   - `listModels` / `listModes` / `listAgents`
 *      → live readers; both lists fall back to a bundled copy when
 *        the probe isn't reachable.
 *
 * All commands run async on the Tauri thread pool. `ensureRunning`
 * is the only one that may block for ~10s (first-run rsync seed of
 * the user-data-dir); subsequent calls return immediately.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * Mirrors the Rust `AttachMode` enum (serde tag = "kind",
 * camelCase). Tells the UI which Cursor process the bridge is talking
 * to so we can explain whether ORGII is using a shared Cursor or its
 * isolated hidden probe:
 *
 * - `sharedAttached` — some Cursor on the debug port, attached. The
 *   `isProbe` flag disambiguates "your real Cursor (you launched it
 *   with the flag)" vs "the isolated probe we spawned earlier".
 * - `realRunningNoDebugPort` — your daily-driver Cursor is running
 *   but didn't expose the flag. **Not fatal**: `ensureRunning`
 *   can use the hidden probe for new chats; continuation chats may
 *   ask to relaunch the owning Cursor with the debug port when they
 *   need to target that same conversation DB.
 * - `needProbe` — no Cursor anywhere; safe to spawn the probe.
 */
export type CursorBridgeAttachMode =
  | { kind: "sharedAttached"; targetId: string; isProbe: boolean }
  | { kind: "realRunningNoDebugPort"; realPids: number[] }
  | { kind: "needProbe" };

/** Mirrors the Rust `EnsureRunningStatus` (serde camelCase). */
export interface EnsureRunningStatus {
  /** CDP endpoint was already responding before we did anything. */
  alreadyRunning: boolean;
  /** We started the isolated Cursor process during this call. */
  launched: boolean;
  /** Renderer Page target id; used to scope subsequent `send` calls. */
  targetId: string | null;
  /** First-run rsync seed of the user-data-dir happened just now. */
  seededUserData: boolean;
  /** Which Cursor we ended up driving — see `CursorBridgeAttachMode`. */
  attachMode: CursorBridgeAttachMode;
}

/**
 * Outcome of a `route` (or pre-routing step inside `send`).
 *
 * `ok = true` means the probe Cursor's `glassActiveAgentService`
 * converged on the requested composer id within 3 s. When
 * `usedOnSelectAgent` is also true, the workbench selection flipped
 * too; when it's false we routed via the storage cell only and the
 * visible composer may lag. Headless sends skip routing entirely and
 * still submit to the right composer id.
 *
 * `ok = false` carries `reason`. Common reasons:
 *  - `"agent <id> not in agentRepositoryService"` — stale id, the
 *    composer has been deleted (or never existed in the probe DB).
 *  - `"glassActiveAgentService did not converge on target within
 *    3000 ms"` — Cursor is mid-update; UI should retry.
 *  - `"agentRepositoryService not registered"` — workbench hasn't
 *    finished booting; UI should retry once the probe is ready.
 */
export interface RouteOutcome {
  ok: boolean;
  reason?: string | null;
  attempts?: number | null;
  /**
   * `true` when routing reached HBC's `onSelectAgent` and invoked
   * it (preferred — also flips the visible UI). `false` when we
   * fell back to `glassActiveAgentService.setActiveAgentId`
   * directly because HBC wasn't reachable on the current surface
   * (the storage cell flips, but the visible UI may lag).
   */
  usedOnSelectAgent?: boolean | null;
  beforeActive?: string | null;
  beforeDom?: string | null;
  afterActive?: string | null;
  afterDom?: string | null;
}

/** Mirrors the Rust `SendResult` (serde camelCase). */
export interface CursorIdeControlSendResult {
  /**
   * Composer id the prompt landed on. Authoritative — comes
   * straight from `composerChatService.submitChatMaybeAbortCurrent`
   * (no `state.vscdb` diff or DOM polling involved).
   */
  composerId: string;
  /** Submitted prompt length, in code-units. */
  textLength: number;
  /**
   * Optional pre-send routing outcome. `undefined` for headless sends
   * and calls without `targetAgentId`; otherwise the lib-level result
   * from `route_to_composer`. The prompt itself always lands on the
   * targeted composer.
   */
  route?: RouteOutcome;
}

/** One composer entry as listed by the probe Cursor. */
export interface CursorAgentSummary {
  id: string;
  title?: string | null;
  modifiedAt?: number | null;
  createdAt?: number | null;
  isArchived: boolean;
  messageCount?: number | null;
}

/** Capability flags surfaced for each model. */
export interface CursorModelCapabilities {
  agent: boolean;
  thinking: boolean;
  images: boolean;
  maxMode: boolean;
  nonMaxMode: boolean;
  planMode: boolean;
  sandbox: boolean;
  cmdK: boolean;
}

/** One available LLM in Cursor's model picker. */
export interface CursorModelEntry {
  /** Canonical id used for `setModel` (e.g. `"claude-opus-4-6"`). */
  name: string;
  serverModelName?: string | null;
  /** Full picker label (e.g. `"Opus 4.6"`). */
  clientDisplayName?: string | null;
  inputboxShortName?: string | null;
  /** Brand id (e.g. `"anthropic"`). */
  vendor?: string | null;
  /** 0 = healthy; non-zero = throttled/down per Cursor's server. */
  degradationStatus?: number | null;
  defaultOn: boolean;
  capabilities: CursorModelCapabilities;
  aliases: string[];
}

/**
 * Where the model list came from. `live` = the probe Cursor
 * answered the CDP eval (post entitlement filtering); `disk` =
 * we fell back to the on-disk `state.vscdb` blob (superset, may
 * include entitlement-gated models); `empty` = no DB found.
 */
export type CursorModelSource = "live" | "disk" | "empty";

export interface CursorIdeControlListModelsResult {
  models: CursorModelEntry[];
  source: CursorModelSource;
}

/**
 * Make sure the isolated Cursor probe instance is running and
 * reachable on `port`. Idempotent — returns immediately when an
 * instance is already up.
 *
 * `port` defaults to 9230 (matches `DEFAULT_REMOTE_DEBUG_PORT` on the
 * Rust side). Override only if 9230 collides with something else on
 * the user's machine.
 */
export async function cursorBridgeEnsureRunning(
  port?: number
): Promise<EnsureRunningStatus> {
  return invoke<EnsureRunningStatus>("cursor_bridge_ensure_running", {
    port,
  });
}

export async function cursorBridgeEnsureRealCursorRunning(
  port?: number
): Promise<EnsureRunningStatus> {
  return invoke<EnsureRunningStatus>(
    "cursor_bridge_ensure_real_cursor_running",
    {
      port,
    }
  );
}

export async function cursorBridgeRestartRealCursorWithDebugPort(
  port?: number
): Promise<EnsureRunningStatus> {
  return invoke<EnsureRunningStatus>(
    "cursor_bridge_restart_real_cursor_with_debug_port",
    { port }
  );
}

/**
 * Light-weight readiness check — returns the renderer target id when
 * a probe instance is live, otherwise `null`. Never spawns a new
 * Cursor process.
 */
export async function cursorBridgeStatus(
  port?: number
): Promise<string | null> {
  return invoke<string | null>("cursor_bridge_status", { port });
}

/**
 * Inspect the current Cursor process landscape *without* spawning or
 * relaunching anything. Used by the UI status indicator and by
 * `useEnsureCursorBridge` to decide whether to show the
 * "your daily-driver Cursor is running but unreachable" hint
 * before the user clicks Send.
 *
 * Distinct from `cursorBridgeStatus`, which only answers "is there a
 * renderer target?" and can't distinguish probe vs real Cursor or
 * detect a real Cursor that's running without the debug port.
 */
export async function cursorBridgeAttachMode(
  port?: number
): Promise<CursorBridgeAttachMode> {
  return invoke<CursorBridgeAttachMode>("cursor_bridge_attach_mode", { port });
}

export interface CursorIdeControlSendParams {
  text: string;
  port?: number;
  /** Pin a specific renderer Page when there are multiple windows. */
  targetId?: string;
  /**
   * Submit to this exact composer id. The service call does not need
   * Cursor's visible composer to change.
   */
  targetAgentId?: string;
  /**
   * Opt into switching Cursor's workbench selection before sending.
   * Defaults to false so ORGII follow-ups stay headless.
   */
  routeVisible?: boolean;
}

/** Submit a prompt to the live Cursor probe instance. */
export async function cursorBridgeSend(
  params: CursorIdeControlSendParams
): Promise<CursorIdeControlSendResult> {
  return invoke<CursorIdeControlSendResult>("cursor_bridge_send", {
    text: params.text,
    port: params.port,
    targetId: params.targetId,
    targetAgentId: params.targetAgentId,
    routeVisible: params.routeVisible,
  });
}

/**
 * Switch the probe Cursor's standalone Agents view to `agentId`
 * without sending anything. Returns the lib-level routing outcome —
 * `ok` indicates the DOM converged on the target.
 */
export async function cursorBridgeRoute(params: {
  agentId: string;
  port?: number;
  targetId?: string;
}): Promise<RouteOutcome> {
  return invoke<RouteOutcome>("cursor_bridge_route", {
    agentId: params.agentId,
    port: params.port,
    targetId: params.targetId,
  });
}

/**
 * Enumerate every composer the probe Cursor knows about. Frontend
 * is responsible for sorting — repository iteration order is not
 * guaranteed reverse-chronological.
 */
export async function cursorBridgeListAgents(
  port?: number,
  targetId?: string
): Promise<CursorAgentSummary[]> {
  return invoke<CursorAgentSummary[]>("cursor_bridge_list_agents", {
    port,
    targetId,
  });
}

/**
 * Read Cursor's available-LLM list (Phase 3d).
 *
 * Tries the live CDP path first (reflects entitlement filtering and
 * server pushes). When that's unavailable — probe Cursor not
 * running, eval threw, etc. — falls back to reading `state.vscdb`
 * directly so the picker doesn't show empty during probe spawn.
 *
 * Pass `preferDisk = true` to skip the live path when the caller
 * already knows the probe isn't running and wants to avoid the
 * 3 s discovery timeout.
 */
export async function cursorBridgeListModels(params?: {
  port?: number;
  targetId?: string;
  preferDisk?: boolean;
}): Promise<CursorIdeControlListModelsResult> {
  return invoke<CursorIdeControlListModelsResult>("cursor_bridge_list_models", {
    port: params?.port,
    targetId: params?.targetId,
    preferDisk: params?.preferDisk,
  });
}

/**
 * Set the model the next prompt will use on `agentId`. The
 * implementation prefers a per-composer scope and falls back to
 * the global composer scope when the per-composer handle isn't
 * reachable.
 */
export async function cursorBridgeSetModel(params: {
  agentId: string;
  modelName: string;
  port?: number;
  targetId?: string;
}): Promise<void> {
  return invoke<void>("cursor_bridge_set_model", {
    agentId: params.agentId,
    modelName: params.modelName,
    port: params.port,
    targetId: params.targetId,
  });
}

/**
 * Cheap freshness probe (single SQLite SELECT) for the focused
 * `cursoride-*` session. Returns ms-epoch of the composer's most
 * recent state mutation — bubble appended, model switched, status
 * flipped — or `null` when no timestamp is recorded.
 *
 * The banner polls this at 1–4 s intervals while focused. We only
 * re-load the full chunk list when the timestamp advanced, so the
 * steady-state cost is ~1 SELECT per tick instead of re-parsing
 * every bubble.
 */
export async function cursorBridgeComposerLastUpdatedAt(
  agentId: string
): Promise<number | null> {
  return invoke<number | null>("cursor_bridge_composer_last_updated_at", {
    agentId,
  });
}

/** Mirrors the Rust `NewComposerResult` (serde camelCase). */
export interface CursorIdeControlNewComposerResult {
  /**
   * Composer id Cursor allocated for the new chat. Authoritative
   * — returned directly by `composerService.createComposer`, no
   * DOM polling or `state.vscdb` diff involved.
   */
  composerId: string;
  /**
   * Echo of the unifiedMode (`"agent"`, `"plan"`, `"ask"`, …) we
   * asked Cursor to boot the new composer into. `null` when the
   * caller didn't pin a mode (Cursor used its default).
   */
  unifiedMode: string | null;
  /** Length of the seed prompt we submitted, in code-units. */
  textLength: number;
}

export interface CursorIdeControlNewComposerParams {
  text: string;
  port?: number;
  targetId?: string;
  /**
   * Switch the new composer to this model name *after* the create
   * dispatch returns. The composer id is known at that point so we
   * can call `setModelConfigForComposer` per-composer (preferred);
   * a global `setSpecificModel("composer", …)` is the silent
   * fallback when the per-composer handle isn't reachable. Pass
   * `undefined` to inherit Cursor's current default.
   */
  modelName?: string;
  /**
   * Boot the new composer in this unified mode (Agent / Plan /
   * Debug / Ask / Multitask / Project). Applied at create time via
   * `partialState.unifiedMode` — no follow-up switch round-trip.
   * Pass `undefined` to inherit Cursor's default (`agent`).
   */
  modeId?: string;
}

/**
 * Open a brand-new Cursor composer and seed it with `text` —
 * "start a Cursor IDE session from ORGII's creator".
 *
 * Sequence on the Rust side:
 *   1. ensure the real Cursor DB owner is reachable over CDP, launching hidden when needed
 *   2. `composerService.createComposer({ partialState: { unifiedMode },
 *       openInNewTab: false })` returns the canonical composer id
 *       synchronously
 *   3. `composerChatService.submitChatMaybeAbortCurrent(id, text)`
 *       seeds the chat with the user's first prompt
 *   4. (optional) `modelConfigService.setModelConfigForComposer(handle,
 *       { modelName })` if the caller pinned a model; falls through to
 *       Cursor's default on failure
 *
 * No DOM polling, no `state.vscdb` diff. The returned `composerId`
 * is the same id Cursor commits to disk and the same id every
 * subsequent `cursorBridgeSend({ targetAgentId })` should use.
 *
 * Use this for the "create a new Cursor IDE chat" creator flow. For
 * sending into an existing composer, use [`cursorBridgeSend`] with
 * `targetAgentId`.
 */
export async function cursorBridgeNewComposer(
  params: CursorIdeControlNewComposerParams
): Promise<CursorIdeControlNewComposerResult> {
  return invoke<CursorIdeControlNewComposerResult>(
    "cursor_bridge_new_composer",
    {
      text: params.text,
      port: params.port,
      targetId: params.targetId,
      modelName: params.modelName,
      modeId: params.modeId,
    }
  );
}

/**
 * Read the model `agentId` was last using, straight from
 * `state.vscdb`. Cheap (no CDP round-trip) — the banner calls this
 * on mount to seed the picker pill with the composer's actual model
 * instead of the generic "default" placeholder.
 *
 * Returns `null` when:
 * - the composer row exists but has no `modelConfig` (older
 *   Cursor builds, or composers that never completed a turn)
 * - neither the probe DB nor the user's real Cursor DB exists
 *
 * Throws only on real DB / JSON failures.
 */
export async function cursorBridgeGetComposerModel(
  agentId: string
): Promise<string | null> {
  return invoke<string | null>("cursor_bridge_get_composer_model", {
    agentId,
  });
}

/**
 * Read Cursor's *global* default composer model from `state.vscdb`
 * (`applicationUser.aiSettings.modelConfig.composer.modelName`).
 *
 * That's the model a brand-new Cursor chat inherits when the user
 * opens the picker without selecting anything. We seed the pill
 * with it in two paths:
 *  - SessionCreator (no composer yet, but we want a real label
 *    instead of the generic "Default Model" placeholder).
 *  - In-session, when the per-composer `getComposerModel` returns
 *    `null` (composer never completed a turn, older Cursor build).
 *
 * The literal `"default"` is preserved as-is — that's a real entry
 * in `availableDefaultModels2` whose label is "Auto", and the
 * picker resolves it through the normal model-list lookup. Returns
 * `null` when the row is missing or the field is empty.
 */
export async function cursorBridgeGetDefaultModel(): Promise<string | null> {
  return invoke<string | null>("cursor_bridge_get_default_model");
}

/** One unified-mode entry as listed by the probe Cursor. */
export interface CursorModeEntry {
  /** Canonical id used for `setMode` (e.g. `"agent"`, `"plan"`). */
  id: string;
  /** Picker label (e.g. `"Agent"`, `"Plan"`). */
  name: string;
  description?: string | null;
  /** Cursor codicon id (e.g. `"infinity"`, `"todos"`). */
  icon?: string | null;
  /** Workbench command id (e.g. `"composerMode.agent"`). */
  actionId?: string | null;
}

/**
 * Where the mode list came from. `live` = the probe Cursor answered
 * the CDP eval (post mode-service registration); `bundled` = we
 * served the hard-coded fallback because the probe wasn't reachable.
 *
 * Cursor's mode set is small and stable across versions, so the
 * bundled fallback is a closer match to the live list than the
 * model picker's `disk` fallback is to its live list. Frontend
 * doesn't need to surface the source unless we want a "(cached)"
 * badge for parity with the model picker.
 */
export type CursorModeSource = "live" | "bundled";

export interface CursorIdeControlListModesResult {
  modes: CursorModeEntry[];
  source: CursorModeSource;
}

/**
 * Read Cursor's unified-mode picker (Agent / Plan / Debug / Ask /
 * Multitask / Project).
 *
 * Tries the live CDP path first (`composerModesService.getAllModes()`),
 * with a 4 s budget; falls back to a bundled snapshot of Cursor's
 * built-in modes when the probe is unreachable so the picker never
 * strands on a loading spinner.
 */
export async function cursorBridgeListModes(params?: {
  port?: number;
  targetId?: string;
}): Promise<CursorIdeControlListModesResult> {
  return invoke<CursorIdeControlListModesResult>("cursor_bridge_list_modes", {
    port: params?.port,
    targetId: params?.targetId,
  });
}

/**
 * Read the unified mode `agentId` was last using, straight from
 * `state.vscdb` (`composerData:<uuid>.unifiedMode`). Cheap — no
 * CDP round-trip. Returns `null` when the composer row has no
 * recorded mode (older Cursor builds, or composers created before
 * the unified-mode picker shipped).
 */
export async function cursorBridgeGetComposerMode(
  agentId: string
): Promise<string | null> {
  return invoke<string | null>("cursor_bridge_get_composer_mode", {
    agentId,
  });
}

/**
 * Switch `agentId` to the unified mode `modeId` (`"agent"`, `"plan"`,
 * `"debug"`, `"chat"`, `"multitask"`, `"project"`). Composer-targeted
 * via `composerModesService.setComposerUnifiedMode`. Unknown mode ids
 * surface as a thrown error (the lib validates against the live
 * `getAllModes()` list before applying), so the caller can react
 * instead of silently no-opping.
 */
export async function cursorBridgeSetMode(params: {
  agentId: string;
  modeId: string;
  port?: number;
  targetId?: string;
}): Promise<void> {
  return invoke<void>("cursor_bridge_set_mode", {
    agentId: params.agentId,
    modeId: params.modeId,
    port: params.port,
    targetId: params.targetId,
  });
}

/**
 * Start a streaming delta watch for a `cursoride-*` session.
 *
 * Connects a persistent CDP WebSocket to the Cursor renderer at `port`,
 * injects a MutationObserver that fires `window.__orgii_delta__(payload)`
 * on every new token appended to the composer bubble, and broadcasts each
 * delta as a `code_session.activity` event to the session's IPC channel.
 *
 * If a watch is already active for `sessionId` it is cancelled first,
 * so at most one watcher exists per session.
 *
 * Call `cursorBridgeUnwatchComposer` when the session ends to clean up
 * the long-lived WebSocket connection.
 */
export async function cursorBridgeWatchComposer(params: {
  sessionId: string;
  composerId: string;
  port?: number;
}): Promise<void> {
  return invoke<void>("cursor_bridge_watch_composer", {
    sessionId: params.sessionId,
    composerId: params.composerId,
    port: params.port,
  });
}

/**
 * Cancel the streaming delta watch for a `cursoride-*` session.
 *
 * No-op (returns `Ok`) when no watch is active for `sessionId`.
 */
export async function cursorBridgeUnwatchComposer(params: {
  sessionId: string;
}): Promise<void> {
  return invoke<void>("cursor_bridge_unwatch_composer", {
    sessionId: params.sessionId,
  });
}
