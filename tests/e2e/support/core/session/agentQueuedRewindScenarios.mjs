import fs from "node:fs";
import path from "node:path";

import {
  assertStationSurfacesConsistent,
  waitForRuntimeIdle,
} from "./agentQueuedControlScenarios.mjs";
import {
  configureScenario,
  execJS,
  installControlFlowInstrumentation,
  invokeE2E,
  js,
  readControlFlowInstrumentation,
  summarizeChatState,
  summarizePageDump,
  typeAndClickSend,
  unwrap,
  waitForApp,
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
  await waitForMarkerFile(config, filePath, markerText, 60_000);
}

async function reloadAndOpenActiveSession(sessionId, label) {
  await browser.refresh();
  await waitForApp();
  // CLI sessions may need a moment for the adapter to settle after page
  // reload before openSession can locate the session in the store. Retry
  // the openSession call up to 3 times with a short delay if chatEventCount
  // is still 0 — this is a known race on reload for CLI sessions where the
  // session-persistence cache eviction races against the initial history load.
  const MAX_OPEN_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_OPEN_ATTEMPTS; attempt++) {
    unwrap(
      await invokeE2E("openSession", sessionId),
      `${label}-openSession-attempt-${attempt}`
    );
    const settled = await browser
      .waitUntil(
        async () => {
          const state = await invokeE2E("inspectChatState");
          return state.activeSessionId === sessionId && state.chatEventCount > 0;
        },
        { timeout: 20_000, interval: 1_000 }
      )
      .catch(() => false);
    if (settled) return;
    if (attempt < MAX_OPEN_ATTEMPTS) {
      // Give the CLI adapter more time to finish the post-reload history load
      // before retrying openSession.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
  // Final check with full error message if all attempts exhausted.
  await browser.waitUntil(
    async () => {
      const state = await invokeE2E("inspectChatState");
      return state.activeSessionId === sessionId && state.chatEventCount > 0;
    },
    {
      timeout: 5_000,
      interval: 1_000,
      timeoutMsg: `${label} did not restore session after reload; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function clickEditResendWithRevertDialog(label, originalPrompt, editedPrompt) {
  const editClicked = await execJS(`
    const targetText = ${JSON.stringify(originalPrompt.slice(0, 120))};
    const cards = Array.from(document.querySelectorAll('[data-testid="chat-message-user-editable"]'));
    const card = cards.find((node) => (node.textContent || '').includes(targetText));
    if (!card) return { clicked: false, reason: 'missing-card', count: cards.length };
    const button = card.querySelector('[data-testid="chat-message-user-edit-button"]');
    if (button) button.click();
    else card.click();
    return { clicked: true };
  `);
  if (!editClicked?.clicked) {
    throw new Error(`${label} could not open edit composer: ${JSON.stringify(editClicked)}`);
  }

  const inputSelector = '[data-testid="chat-message-edit-composer"] [contenteditable="true"]';
  await browser.waitUntil(async () => execJS(js.exists(inputSelector)), {
    timeout: 10_000,
    interval: 500,
    timeoutMsg: `${label} edit composer did not mount; dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
  });

  const typed = await execJS(js.clearAndType(inputSelector, editedPrompt));
  if (!typed.includes(editedPrompt)) {
    throw new Error(`${label} failed to type edited prompt: ${JSON.stringify(typed)}`);
  }

  const resendClicked = await execJS(`
    const editComposer = document.querySelector('[data-testid="chat-message-edit-composer"]');
    const buttons = Array.from((editComposer || document).querySelectorAll('button'));
    const resend = buttons.find((button) => (button.textContent || '').trim() === 'Resend');
    if (!resend) return { clicked: false, buttons: buttons.map((button) => (button.textContent || '').trim()).filter(Boolean) };
    resend.click();
    return { clicked: true };
  `);
  if (!resendClicked?.clicked) {
    throw new Error(`${label} could not click Resend: ${JSON.stringify(resendClicked)}`);
  }

  await browser.waitUntil(
    async () =>
      (await execJS(js.exists('[data-testid="rewind-file-changes-revert"]'))) &&
      (await execJS(js.exists('[data-testid="rewind-file-changes-keep"]'))),
    {
      timeout: 10_000,
      interval: 500,
      timeoutMsg: `${label} revert/keep dialog did not appear after edit resend; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );

  const revertClicked = await execJS(js.click('[data-testid="rewind-file-changes-revert"]'));
  if (revertClicked !== "clicked") {
    throw new Error(`${label} could not click Revert changes: ${revertClicked}`);
  }
}

async function runRewindScenario(config) {
  const repoPath = createTempRepo(config.label);
  const markerFile = `orgii-rewind-${config.label.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.md`;
  const markerText = `ORGII_REWIND_MARKER_${config.label.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
  const replacementMarkerFile = `orgii-rewind-replacement-${config.label.replace(/[^a-zA-Z0-9]/g, "-")}-${Date.now()}.md`;
  const replacementMarkerText = `ORGII_REWIND_REPLACEMENT_${config.label.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
  const prompt = rewindPromptForConfig(config, markerFile, markerText);
  const replacementPrompt = rewindPromptForConfig(
    config,
    replacementMarkerFile,
    replacementMarkerText
  );

  try {
    await configureScenario(config, { repoPath });
    const inputSelector = await waitForChatInput();
    await typeAndClickSend(inputSelector, prompt);
    await waitForChatLaunched(prompt);

    const filePath = path.join(repoPath, markerFile);
    await ensureMarkerFileCreated(config, filePath, markerText);
    await waitForRuntimeIdle(`${config.label}-rewind-before-undo`);
    await waitForFileChangesPanel(`${config.label}-rewind`);
    await installControlFlowInstrumentation(`${config.label}-rewind-undo`);

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
        timeoutMsg: `${config.label} Undo All did not rewind file or expose Redo All; exists=${fs.existsSync(filePath)} content=${fs.existsSync(filePath) ? JSON.stringify(fs.readFileSync(filePath, "utf8")) : "<missing>"} fileChanges=${JSON.stringify(await execJS(js.fileChanges))} controlFlow=${JSON.stringify(await readControlFlowInstrumentation())}`,
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

    try {
      await browser.waitUntil(
        async () => {
          const finalFileChanges = await execJS(js.fileChanges);
          return !finalFileChanges.undoAll && !finalFileChanges.redoAll;
        },
        {
          timeout: 10_000,
          interval: 500,
          timeoutMsg: `${config.label} file review controls remained after Redo All`,
        }
      );
    } catch (error) {
      const finalFileChanges = await execJS(js.fileChanges).catch(() => null);
      throw new Error(
        `${config.label} file review controls remained after Redo All; fileChanges=${JSON.stringify(finalFileChanges)}; original=${error instanceof Error ? error.message : String(error)}`
      );
    }
    await assertStationSurfacesConsistent(`${config.label}-redo`);

    await clickEditResendWithRevertDialog(
      `${config.label}-edit-resend-revert-dialog`,
      prompt,
      replacementPrompt
    );

    const replacementFilePath = path.join(repoPath, replacementMarkerFile);
    await ensureMarkerFileCreated(
      config,
      replacementFilePath,
      replacementMarkerText
    );
    await waitForRuntimeIdle(`${config.label}-rewind-after-edit-resend`);
    await browser.waitUntil(
      async () => {
        const originalStillHasMarker =
          fs.existsSync(filePath) &&
          fs.readFileSync(filePath, "utf8").includes(markerText);
        const replacementHasMarker =
          fs.existsSync(replacementFilePath) &&
          fs.readFileSync(replacementFilePath, "utf8").includes(replacementMarkerText);
        return !originalStillHasMarker && replacementHasMarker;
      },
      {
        timeout: 60_000,
        interval: 1_000,
        timeoutMsg: `${config.label} edit-resend Revert changes did not rewind original file and create replacement; originalExists=${fs.existsSync(filePath)} original=${fs.existsSync(filePath) ? JSON.stringify(fs.readFileSync(filePath, "utf8")) : "<missing>"} replacementExists=${fs.existsSync(replacementFilePath)} replacement=${fs.existsSync(replacementFilePath) ? JSON.stringify(fs.readFileSync(replacementFilePath, "utf8")) : "<missing>"} state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}`,
      }
    );
    await assertCliHistoryMutationIfApplicable(
      `${config.label}-after-edit-resend-revert`,
      "file_rewind",
      3
    );
    await assertStationSurfacesConsistent(`${config.label}-edit-resend-revert`);

    const sessionId = await activeSessionId(`${config.label}-reload-history`);
    await reloadAndOpenActiveSession(
      sessionId,
      `${config.label}-reload-after-edit-resend-revert`
    );
    await browser.waitUntil(
      async () => {
        const state = await invokeE2E("inspectChatState");
        const userTexts = (state.chatEvents ?? [])
          .filter((event) => event.source === "user")
          .map((event) => String(event.displayText ?? ""));
        const replacementMatches = userTexts.filter((text) =>
          text.includes(replacementMarkerText)
        );
        const originalMatches = userTexts.filter((text) => text.includes(markerText));
        return replacementMatches.length === 1 && originalMatches.length === 0;
      },
      {
        timeout: 30_000,
        interval: 1_000,
        timeoutMsg: `${config.label} reload/resume history was inconsistent after edit-resend rewind; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}`,
      }
    );
    await assertStationSurfacesConsistent(`${config.label}-reload-history`);
  } finally {
    await execJS(
      `window.__orgiiE2EAutoConfirmDestructive = false; return true;`
    ).catch(() => undefined);
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
}

export { runRewindScenario };
