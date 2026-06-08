/**
 * useRepoSetup
 *
 * Creates an agent session to analyze and set up a repository.
 * Builds a structured prompt from repo detection results, calls
 * SessionService.create(), and navigates to the session workspace.
 *
 * Supports both Rust agent and CLI agent sessions depending on the
 * model selection stored in creatorDefaultModelSelectionAtom.
 */
import { useSetAtom } from "jotai";
import { useCallback, useRef, useState } from "react";

import type { CliAgentType } from "@src/api/tauri/rpc/schemas/validation";
import type { KeySource } from "@src/api/tauri/session";
import {
  loadSessionAtom,
  pendingSyntheticEventAtom,
} from "@src/engines/SessionCore/core/atoms";
import { SessionService } from "@src/engines/SessionCore/services/SessionService";
import { createSyntheticUserEvent } from "@src/engines/SessionCore/sync/adapters/shared";
import { createLogger } from "@src/hooks/logger";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { setSessionRuntimeStatusAtom } from "@src/store/session/cliSessionStatusAtom";

import { buildSetupPrompt } from "../config";
import type { DetectedConfigFile, RepoType } from "../types";
import { useSetupRepoAutoLaunch } from "./useSetupRepoAutoLaunch";

const logger = createLogger("useRepoSetup");

export interface RepoSetupContext {
  repoPath: string;
  repoName: string;
  repoType: RepoType;
  repoTypeLabel: string;
  configFiles: DetectedConfigFile[];
  hasDocker: boolean;
  hasMakefile: boolean;
}

export interface LaunchOptions {
  extraInstructions?: string;
  trusted?: boolean;
  /** Resolved from creatorDefaultModelSelectionAtom — own-key own-model path */
  model?: string;
  accountId?: string;
  /** "own_key" | "hosted_key" — determines which create path to use */
  keySource?: KeySource;
  /** Set when a CLI agent (Claude Code, Cursor, etc.) was selected */
  cliAgentType?: CliAgentType;
  /** Marketplace listing model ID (hosted_key sessions) */
  listingModel?: string;
  /** Marketplace listing model type / provider */
  listingModelType?: string;
  /** Marketplace tier (basic / standard / premium / vip) */
  tier?: string;
}

export interface UseRepoSetupReturn {
  launching: boolean;
  /** The session ID of the active setup session (null when idle). */
  setupSessionId: string | null;
  launchSetup: (
    context: RepoSetupContext,
    options?: LaunchOptions
  ) => Promise<void>;
}

export function useRepoSetup(): UseRepoSetupReturn {
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const [setupSessionId, setSetupSessionId] = useState<string | null>(null);
  const { openSession } = useSessionView();
  const dispatchLoadSession = useSetAtom(loadSessionAtom);
  const setPendingSyntheticEvent = useSetAtom(pendingSyntheticEventAtom);
  const setSessionRuntimeStatus = useSetAtom(setSessionRuntimeStatusAtom);

  // Auto-launch tracking: open WorkStation browser tab when the agent
  // calls setup_repo with action="launch_app".
  useSetupRepoAutoLaunch(setupSessionId);

  const launchSetup = useCallback(
    async (context: RepoSetupContext, options?: LaunchOptions) => {
      // Use a ref so this guard is always current regardless of when the
      // callback was captured — prevents stale-closure double-fire.
      if (launchingRef.current) return;

      launchingRef.current = true;
      setLaunching(true);
      try {
        let prompt = buildSetupPrompt(context, options?.trusted ?? false);

        if (options?.extraInstructions?.trim()) {
          prompt += `\n\n## Additional Instructions\n\n${options.extraInstructions.trim()}`;
        }

        const sessionName = `Setup: ${context.repoName}`;
        const isCli = Boolean(options?.cliAgentType);
        const isHosted = options?.keySource === "hosted_key";

        const { sessionId } = await SessionService.create({
          task: prompt,
          repoPath: context.repoPath,
          name: sessionName,
          mode: isCli ? undefined : "build",
          ...(options?.accountId ? { accountId: options.accountId } : {}),
          ...(isCli
            ? {
                cliAgentType: options!.cliAgentType,
                keySource: options?.keySource,
              }
            : isHosted
              ? {
                  keySource: options?.keySource,
                  listingModel: options?.listingModel,
                  listingModelType: options?.listingModelType,
                  tier: options?.tier,
                }
              : {
                  model: options?.model,
                }),
        });

        logger.info(
          `Created setup session ${sessionId} for ${context.repoName}`
        );

        // Track session so useSetupRepoAutoLaunch can listen for launch_app events.
        setSetupSessionId(sessionId);

        // Inject a synthetic user event so the ChatHistory panel shows the
        // prompt immediately — identical to the useSessionLaunch pattern.
        // Without this, useSessionSync gets an empty cache hit (session is
        // in-flight / running), sets loadStatus="loaded" with zero events,
        // and the 5-second grace timer triggers "No activity yet" before
        // the first real event arrives from the Tauri Channel.
        const syntheticEvent = createSyntheticUserEvent(sessionId, prompt);
        setPendingSyntheticEvent(syntheticEvent);
        dispatchLoadSession({ sessionId, events: [syntheticEvent] });
        setSessionRuntimeStatus({ status: "running", source: "repo-setup" });

        openSession(sessionId, sessionName, context.repoPath);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to launch setup for ${context.repoName}: ${msg}`);
        throw error;
      } finally {
        launchingRef.current = false;
        setLaunching(false);
      }
    },
    [
      openSession,
      dispatchLoadSession,
      setPendingSyntheticEvent,
      setSessionRuntimeStatus,
    ]
  );

  return { launching, setupSessionId, launchSetup };
}
