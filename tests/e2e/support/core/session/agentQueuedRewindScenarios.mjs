import fs from "node:fs";
import path from "node:path";

import { assertStationSurfacesConsistent } from "./agentQueuedControlScenarios.mjs";
import {
  configureScenario,
  execJS,
  invokeE2E,
  js,
  typeAndClickSend,
  unwrap,
  waitForChatInput,
  waitForChatLaunched,
} from "./agentQueuedFollowupDriver.mjs";
import {
  clickRedoAllAndConfirm,
  clickUndoAllAndConfirm,
  createTempRepo,
  rewindPromptForConfig,
  waitForFileChangesPanel,
  waitForMarkerFile,
} from "./agentQueuedWorkspaceHelpers.mjs";

async function activeSessionId(label) {
  const active = unwrap(
    await invokeE2E("getActiveSessionId"),
    `${label}-getActiveSessionId`
  );
  if (!active.sessionId) {
    throw new Error(`${label} has no active session id`);
  }
  return active.sessionId;
}

async function activeCliSessionStatus(label) {
  const sessionId = await activeSessionId(label);
  const result = unwrap(
    await invokeE2E("inspectCliSessionStatus", sessionId),
    `${label}-inspectCliSessionStatus`
  );
  return result.session;
}

async function activeCliHistoryMutation(label) {
  const sessionId = await activeSessionId(label);
  const result = unwrap(
    await invokeE2E("inspectCliHistoryMutation", sessionId),
    `${label}-inspectCliHistoryMutation`
  );
  return result.mutation;
}

async function assertCliHistoryMutationIfApplicable(label, reason, minEpoch) {
  const session = await activeCliSessionStatus(label);
  if (!session) return;
  if (session.cli_session_id !== null && session.cli_session_id !== undefined) {
    throw new Error(
      `${label} did not clear CLI native resume id after file-history mutation; session=${JSON.stringify(session)}`
    );
  }
  const mutation = await activeCliHistoryMutation(label);
  if (!mutation) {
    throw new Error(`${label} did not persist CLI history mutation marker`);
  }
  if (mutation.reason !== reason || mutation.epoch < minEpoch) {
    throw new Error(
      `${label} persisted unexpected CLI history mutation marker; expected reason=${reason} minEpoch=${minEpoch} actual=${JSON.stringify(mutation)}`
    );
  }
}

async function ensureMarkerFileCreated(config, filePath, markerText) {
  await waitForMarkerFile(config, filePath, markerText, 25_000);
}

async function runRewindScenario(config) {
  const repoPath = createTempRepo(config.label);
  const markerFile = `orgii-rewind-${config.label.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.md`;
  const markerText = `ORGII_REWIND_MARKER_${config.label.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
  const prompt = rewindPromptForConfig(config, markerFile, markerText);

  try {
    await configureScenario(config, { repoPath });
    const inputSelector = await waitForChatInput();
    await typeAndClickSend(inputSelector, prompt);
    await waitForChatLaunched(prompt);

    const filePath = path.join(repoPath, markerFile);
    await ensureMarkerFileCreated(config, filePath, markerText);
    await waitForFileChangesPanel(`${config.label}-rewind`);

    await clickUndoAllAndConfirm(`${config.label}-rewind`);

    await browser.waitUntil(
      async () => {
        const panel = await execJS(js.fileChanges);
        const fileExists = fs.existsSync(filePath);
        const fileHasMarker = fileExists
          ? fs.readFileSync(filePath, "utf8").includes(markerText)
          : false;
        return !panel.undoAll && panel.redoAll && !panel.redoAllDisabled && !fileHasMarker;
      },
      {
        timeout: 60_000,
        timeoutMsg: `${config.label} Undo All did not rewind file or expose Redo All; exists=${fs.existsSync(filePath)} content=${fs.existsSync(filePath) ? JSON.stringify(fs.readFileSync(filePath, "utf8")) : "<missing>"} fileChanges=${JSON.stringify(await execJS(js.fileChanges))}`,
      }
    );
    await assertCliHistoryMutationIfApplicable(
      `${config.label}-after-undo`,
      "file_rewind",
      1
    );

    await clickRedoAllAndConfirm(`${config.label}-redo`);
    await browser.waitUntil(
      async () =>
        fs.existsSync(filePath) &&
        fs.readFileSync(filePath, "utf8").includes(markerText),
      {
        timeout: 30_000,
        timeoutMsg: `${config.label} Redo All did not restore file; exists=${fs.existsSync(filePath)} content=${fs.existsSync(filePath) ? JSON.stringify(fs.readFileSync(filePath, "utf8")) : "<missing>"} fileChanges=${JSON.stringify(await execJS(js.fileChanges))}`,
      }
    );
    await assertCliHistoryMutationIfApplicable(
      `${config.label}-after-redo`,
      "snapshot_restore",
      2
    );

    const surfaces = await assertStationSurfacesConsistent(
      `${config.label}-redo`
    );
    if (
      surfaces.myStation.undoAll ||
      surfaces.agentStation.undoAll ||
      surfaces.myStation.redoAll ||
      surfaces.agentStation.redoAll
    ) {
      throw new Error(
        `${config.label} file review controls remained after Redo All; surfaces=${JSON.stringify(surfaces)}`
      );
    }
  } finally {
    await execJS(
      `window.__orgiiE2EAutoConfirmDestructive = false; return true;`
    ).catch(() => undefined);
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
}

export { runRewindScenario };
