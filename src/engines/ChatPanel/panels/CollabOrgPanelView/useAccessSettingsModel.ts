import { useAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";

import { collabSessionAccessSettingsAtom } from "@src/store/collaboration/collabOrgsAtom";
import type {
  CollabMemberRecord,
  CollabSessionAccessMode,
  CollabSessionAccessSettings,
} from "@src/store/collaboration/types";
import type { Session } from "@src/store/session";

import {
  createDefaultAccessSettings,
  normalizeWorkspacePath,
  shouldPromptShareOnboarding,
} from "./utils";

interface UseAccessSettingsModelParams {
  orgId: string;
  currentMember: CollabMemberRecord | undefined;
  sessions: Session[];
}

export function useAccessSettingsModel({
  orgId,
  currentMember,
  sessions,
}: UseAccessSettingsModelParams) {
  const [accessSettingsList, setAccessSettingsList] = useAtom(
    collabSessionAccessSettingsAtom
  );
  // OFF → shared transition parked here until the user answers the one-time
  // "share all history / only new sessions" choice (design §6.2/§6.3).
  const [pendingShareMode, setPendingShareMode] =
    useState<CollabSessionAccessMode | null>(null);

  const currentAccessSettings = useMemo(() => {
    if (!currentMember) return null;
    return (
      accessSettingsList.find(
        (settings) =>
          settings.orgId === orgId && settings.memberId === currentMember.id
      ) ?? createDefaultAccessSettings(orgId, currentMember.id)
    );
  }, [accessSettingsList, currentMember, orgId]);

  const workspaceOptions = useMemo(() => {
    const paths = new Set<string>();
    for (const session of sessions) {
      const normalizedPath = normalizeWorkspacePath(session.repoPath);
      if (normalizedPath) paths.add(normalizedPath);
    }
    return Array.from(paths).sort((left, right) => left.localeCompare(right));
  }, [sessions]);

  const updateAccessSettings = useCallback(
    (
      updates: Partial<
        Pick<
          CollabSessionAccessSettings,
          "accessMode" | "workspacePaths" | "shareSince"
        >
      >
    ) => {
      if (!currentMember || !currentAccessSettings) return;
      const nextSettings: CollabSessionAccessSettings = {
        ...currentAccessSettings,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      setAccessSettingsList((current) => {
        const existingIndex = current.findIndex(
          (settings) =>
            settings.orgId === nextSettings.orgId &&
            settings.memberId === nextSettings.memberId
        );
        if (existingIndex < 0) return [nextSettings, ...current];
        const next = [...current];
        next[existingIndex] = nextSettings;
        return next;
      });
    },
    [currentAccessSettings, currentMember, setAccessSettingsList]
  );

  const handleSelectAccessMode = useCallback(
    (accessMode: CollabSessionAccessMode) => {
      if (
        shouldPromptShareOnboarding(
          currentAccessSettings?.accessMode,
          accessMode
        )
      ) {
        setPendingShareMode(accessMode);
        return;
      }
      updateAccessSettings({ accessMode });
    },
    [currentAccessSettings?.accessMode, updateAccessSettings]
  );

  /**
   * Answer to the one-time enable prompt: `shareAllHistory` clears the
   * shareSince gate; the default choice stamps it with "now" so only
   * sessions CREATED from here on are shared (design §6.3).
   */
  const handleConfirmShareOnboarding = useCallback(
    (shareAllHistory: boolean) => {
      if (!pendingShareMode) return;
      updateAccessSettings({
        accessMode: pendingShareMode,
        shareSince: shareAllHistory ? undefined : new Date().toISOString(),
      });
      setPendingShareMode(null);
    },
    [pendingShareMode, updateAccessSettings]
  );

  const handleCancelShareOnboarding = useCallback(() => {
    setPendingShareMode(null);
  }, []);

  const handleToggleWorkspace = useCallback(
    (workspacePath: string) => {
      if (!currentAccessSettings) return;
      const workspacePaths = currentAccessSettings.workspacePaths.includes(
        workspacePath
      )
        ? currentAccessSettings.workspacePaths.filter(
            (path) => path !== workspacePath
          )
        : [...currentAccessSettings.workspacePaths, workspacePath];
      updateAccessSettings({ workspacePaths });
    },
    [currentAccessSettings, updateAccessSettings]
  );

  return {
    currentAccessSettings,
    workspaceOptions,
    pendingShareMode,
    handleSelectAccessMode,
    handleConfirmShareOnboarding,
    handleCancelShareOnboarding,
    handleToggleWorkspace,
  };
}
