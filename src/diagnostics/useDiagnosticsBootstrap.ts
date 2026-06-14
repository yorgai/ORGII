import { useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useSettingValue } from "@src/hooks/settings";
import { sessionsAtom } from "@src/store/session/sessionAtom";
import { settingsLoadedAtom } from "@src/store/settings/settingsAtom";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";

import { createDiagnosticsUsageSnapshot } from "./aggregate";
import {
  diagnosticsConfigure,
  diagnosticsFlushNow,
  diagnosticsRecordUsageSnapshot,
  diagnosticsStart,
} from "./rustBridge";
import { DIAGNOSTICS_LEVEL } from "./types";
import type { DiagnosticsLevel, DiagnosticsServiceConfig } from "./types";

const MINUTE_MS = 60_000;

function normalizeDiagnosticsLevel(value: unknown): DiagnosticsLevel {
  if (
    value === DIAGNOSTICS_LEVEL.OFF ||
    value === DIAGNOSTICS_LEVEL.PERFORMANCE_ONLY ||
    value === DIAGNOSTICS_LEVEL.DEFAULT
  ) {
    return value;
  }
  return DIAGNOSTICS_LEVEL.DEFAULT;
}

export function useDiagnosticsBootstrap(): void {
  const settingsLoaded = useAtomValue(settingsLoadedAtom);
  const diagnosticsLevelSetting = useSettingValue("privacy.diagnosticsLevel");
  const uploadIntervalHours = useSettingValue(
    "privacy.diagnosticsUploadIntervalHours"
  );
  const offlineMode = useSettingValue("privacy.offlineMode");
  const sessions = useAtomValue(sessionsAtom);
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);
  const startedRef = useRef(false);
  const runningRef = useRef(false);

  const diagnosticsLevel = normalizeDiagnosticsLevel(diagnosticsLevelSetting);
  const serviceConfig = useMemo<DiagnosticsServiceConfig>(
    () => ({
      diagnosticsLevel,
      offlineMode,
      uploadIntervalHours,
    }),
    [diagnosticsLevel, offlineMode, uploadIntervalHours]
  );

  useEffect(() => {
    if (!settingsLoaded) return;

    let cancelled = false;
    const configureService = async () => {
      if (!startedRef.current) {
        const started = await diagnosticsStart(serviceConfig);
        if (cancelled) return;
        startedRef.current = started;
        if (started) return;
      }

      await diagnosticsConfigure(serviceConfig);
    };

    void configureService();

    return () => {
      cancelled = true;
    };
  }, [serviceConfig, settingsLoaded]);

  const collectAndSendSnapshot = useCallback(async () => {
    if (runningRef.current) return;
    if (!settingsLoaded || offlineMode) {
      return;
    }

    runningRef.current = true;
    try {
      const snapshot = await createDiagnosticsUsageSnapshot({
        diagnosticsLevel,
        sessions,
        workspaceFolders,
      });
      if (snapshot) {
        await diagnosticsRecordUsageSnapshot(snapshot);
      }
      await diagnosticsFlushNow();
    } finally {
      runningRef.current = false;
    }
  }, [
    diagnosticsLevel,
    offlineMode,
    sessions,
    settingsLoaded,
    workspaceFolders,
  ]);

  useEffect(() => {
    if (!settingsLoaded) return;

    void collectAndSendSnapshot();

    const intervalMs = Math.max(uploadIntervalHours, 1) * 60 * MINUTE_MS;
    const interval = window.setInterval(() => {
      void collectAndSendSnapshot();
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [collectAndSendSnapshot, settingsLoaded, uploadIntervalHours]);
}
