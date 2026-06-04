/* global browser */
import fs from "node:fs";
import path from "node:path";

import {
  clickSendNowForQueuedMarker,
  waitForIdleSendButton,
  waitForQueuedFollowup,
  waitForWorkingTurn,
} from "./agentQueuedControlScenarios.mjs";
import {
  QUEUE_TIMEOUT_MS,
  assertProgressUiSettledAfterAssistantReply,
  configureScenario,
  execJS,
  inspectChatState,
  invokeE2E,
  js,
  summarizeChatState,
  typeAndClickSend,
  waitForChatInput,
  waitForChatLaunched,
  waitForModePill,
} from "./agentQueuedFollowupDriver.mjs";
import {
  assertNoDuplicateThinkingPlaceholders,
  waitForIntermediateStreamEvents,
} from "./agentQueuedPlanScenarios.mjs";
import {
  createTempRepo,
  rewindPromptForConfig,
} from "./agentQueuedWorkspaceHelpers.mjs";
import { WRITE_EFFECT_TOOL_NAMES } from "./toolCoverage.mjs";

async function runAskForceSendScenario(config) {
  const marker = `ASK_FORCE_${config.label.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
  const firstPrompt = [
    `Ask this repository for ${config.label}.`,
    "Give an explanation with 20 short numbered points.",
  ].join(" ");
  const followupPrompt = `Follow-up for the research: acknowledge ${marker} and continue from the previous findings.`;

  await configureScenario(config, { agentExecMode: "ask" });
  await waitForModePill(`${config.label}-ask`, "Ask");
  const inputSelector = await waitForChatInput();
  await typeAndClickSend(inputSelector, firstPrompt);
  await waitForChatLaunched(firstPrompt);
  await waitForWorkingTurn(`${config.label}-ask-force`);
  const chatInputSelector = await waitForChatInput();
  await typeAndClickSend(chatInputSelector, followupPrompt);
  await waitForQueuedFollowup(marker);
  await clickSendNowForQueuedMarker(marker);
  await browser.waitUntil(
    async () => {
      const state = await inspectChatState(`${config.label}-ask-queue`);
      return state.queuedMessages.length === 0;
    },
    {
      timeout: QUEUE_TIMEOUT_MS,
      timeoutMsg: `${config.label} Ask Force Send did not flush queue; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}`,
    }
  );
  await waitForIdleSendButton(`${config.label}-ask-force`);
  await assertNoDuplicateThinkingPlaceholders(`${config.label}-ask-force`);

  const state = await inspectChatState(`${config.label}-ask-final`);
  const ui = await execJS(js.planUi);
  if (state.pendingPlan || ui.cardCount > 0 || state.pendingReviewCount > 0) {
    throw new Error(
      `${config.label} Ask produced plan or writable review state; state=${JSON.stringify(summarizeChatState(state))} ui=${JSON.stringify(ui)}`
    );
  }
}

const WRITE_TOOL_NAMES = new Set(WRITE_EFFECT_TOOL_NAMES);

function hasWriteToolCall(state) {
  return (state.toolEvents ?? []).some((event) =>
    WRITE_TOOL_NAMES.has(event.functionName)
  );
}

async function assertNoWriteEffects(label, filePath) {
  await waitForIdleSendButton(label);
  const state = await inspectChatState(`${label}-read-only`);
  const fileChanges = await execJS(js.fileChanges);
  const fileExists = fs.existsSync(filePath);
  if (
    fileExists ||
    fileChanges.filesPill ||
    fileChanges.undoAll ||
    hasWriteToolCall(state)
  ) {
    throw new Error(
      `${label} allowed write effects in read-only/planning phase; fileExists=${fileExists} writeTool=${hasWriteToolCall(state)} fileChanges=${JSON.stringify(fileChanges)} state=${JSON.stringify(summarizeChatState(state))}`
    );
  }
}

async function runAskWriteDeniedScenario(config) {
  const repoPath = createTempRepo(`${config.label}-ask-write-denied`);
  const markerFile = `orgii-ask-denied-${Date.now()}.md`;
  const markerText = `ORGII_ASK_DENIED_${Date.now()}`;
  const prompt = rewindPromptForConfig(config, markerFile, markerText);
  const filePath = path.join(repoPath, markerFile);

  await configureScenario(config, { repoPath, agentExecMode: "ask" });
  await waitForModePill(`${config.label}-ask-write-denied`, "Ask");
  const inputSelector = await waitForChatInput();
  await typeAndClickSend(inputSelector, prompt);
  await waitForChatLaunched(prompt);
  await assertNoWriteEffects(`${config.label}-ask-write-denied`, filePath);
}

async function removeTempRepoWithRetry(repoPath) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 3 });
      return;
    } catch (error) {
      lastError = error;
      await browser.pause(250 * (attempt + 1));
    }
  }
  throw lastError;
}

async function runIntermediateStreamingScenario(config) {
  const repoPath = createTempRepo(`${config.label}-streaming`);
  const markerFile = `orgii-intermediate-streaming-${Date.now()}.md`;
  const markerText = `ORGII_INTERMEDIATE_STREAMING_${Date.now()}`;
  const prompt = rewindPromptForConfig(config, markerFile, markerText);

  try {
    await configureScenario(config, { repoPath });
    const inputSelector = await waitForChatInput();
    await typeAndClickSend(inputSelector, prompt);
    await waitForChatLaunched(prompt);
    await waitForIntermediateStreamEvents(
      `${config.label}-intermediate-streaming`,
      "REWIND_FILE_CREATED"
    );
    await assertProgressUiSettledAfterAssistantReply(
      `${config.label}-intermediate-streaming`,
      "REWIND_FILE_CREATED"
    );
    await waitForIdleSendButton(`${config.label}-intermediate-streaming`);
  } finally {
    await removeTempRepoWithRetry(repoPath);
  }
}

export {
  runIntermediateStreamingScenario,
  runAskForceSendScenario,
  runAskWriteDeniedScenario,
};
