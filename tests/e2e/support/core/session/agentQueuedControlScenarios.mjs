import {
  QUEUE_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  configureScenario,
  execJS,
  inspectChatState,
  invokeE2E,
  js,
  summarizeChatState,
  summarizePageDump,
  truncateDiagnosticText,
  typeAndClickSend,
  unwrap,
  waitForChatInput,
  waitForChatLaunched,
} from "./agentQueuedFollowupDriver.mjs";

async function switchStationMode(mode, label) {
  const testId =
    mode === "my-station"
      ? "station-mode-my-station"
      : "station-mode-agent-station";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await inspectChatState(`${label}-${mode}-before-click`);
    if (state.stationMode === mode) return true;
    const clicked = await execJS(`
      const directButton = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
      const chipButton = document.querySelector('[data-testid="station-mode-chip"]');
      const button = directButton || chipButton;
      if (!button) return "missing";
      if (button.disabled) return "disabled";
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
      button.click();
      return directButton ? "clicked-direct" : "clicked-chip";
    `);
    if (clicked === "missing") return false;
    if (clicked !== "clicked-direct" && clicked !== "clicked-chip") {
      throw new Error(
        `${label} station switch click failed for ${mode}: ${clicked}; dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`
      );
    }
    await browser.pause(300);
  }
  await browser.waitUntil(
    async () => {
      const state = await inspectChatState(`${label}-${mode}`);
      return state.stationMode === mode;
    },
    {
      timeout: 10_000,
      timeoutMsg: `${label} did not switch to ${mode}; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
  await browser.pause(300);
  return true;
}

async function captureRenderedSurface(mode, label) {
  const switched = await switchStationMode(mode, label);
  if (!switched) return null;
  await browser.waitUntil(
    async () => {
      const snapshot = await execJS(js.renderedSurfaceSnapshot);
      const state = await inspectChatState(`${label}-${mode}-render`);
      return state.chatEvents.some((event) =>
        snapshot.bodyText.includes(event.displayText.slice(0, 60))
      );
    },
    {
      timeout: 20_000,
      timeoutMsg: `${label} ${mode} did not render chat event text; snapshot=${JSON.stringify(await execJS(js.renderedSurfaceSnapshot))} state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}`,
    }
  );
  return execJS(js.renderedSurfaceSnapshot);
}

async function assertStationSurfacesConsistent(label) {
  const initialSurface = await execJS(js.renderedSurfaceSnapshot);
  const myStation = await captureRenderedSurface("my-station", label);
  const agentStation = await captureRenderedSurface("agent-station", label);
  if (!myStation || !agentStation) {
    return {
      myStation: myStation ?? initialSurface,
      agentStation: agentStation ?? initialSurface,
      comparedBothStations: false,
    };
  }
  if (myStation.filesPillText !== agentStation.filesPillText) {
    throw new Error(
      `${label} file pill mismatch between My Station and Agent: my=${JSON.stringify(myStation)} agent=${JSON.stringify(agentStation)}`
    );
  }
  if (myStation.roundLabel !== agentStation.roundLabel) {
    throw new Error(
      `${label} round label mismatch between My Station and Agent: my=${JSON.stringify(myStation)} agent=${JSON.stringify(agentStation)}`
    );
  }
  if (myStation.changesCount !== agentStation.changesCount) {
    throw new Error(
      `${label} changes count mismatch between My Station and Agent: my=${JSON.stringify(myStation)} agent=${JSON.stringify(agentStation)}`
    );
  }
  return { myStation, agentStation, comparedBothStations: true };
}

async function waitForWorkingTurn(label) {
  await browser.waitUntil(
    async () => {
      const state = await inspectChatState(label);
      const sendState = await execJS(js.sendState);
      return (
        (state.isSessionActive || state.runtimeStatus === "running") &&
        sendState?.state === "stop"
      );
    },
    {
      timeout: 20_000,
      timeoutMsg: `${label} did not enter a working state before follow-up; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} sendState=${JSON.stringify(await execJS(js.sendState))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function clickMainAction(expectedState, label, timeout = 15_000) {
  let lastClickResult = null;
  await browser.waitUntil(
    async () => {
      lastClickResult = await execJS(
        js.clickWhenState('[data-testid="chat-send-button"]', expectedState)
      );
      return lastClickResult === "clicked";
    },
    {
      timeout,
      interval: 250,
      timeoutMsg: `${label} main action never became clickable ${expectedState}; lastClickResult=${JSON.stringify(lastClickResult)} state=${JSON.stringify(await execJS(js.sendState))}`,
    }
  );
}

async function typeAndSubmitWithShortcut(inputSelector, prompt) {
  const typed = await execJS(js.clearAndType(inputSelector, prompt));
  if (!typed.includes(prompt)) {
    throw new Error(`Failed to type prompt: ${typed}`);
  }
  await browser.pause(300);
  const submitted = await execJS(`
    const element = document.querySelector(${JSON.stringify(inputSelector)});
    if (!element) return "missing";
    element.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
      metaKey: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented ? "submitted" : "not-handled";
  `);
  if (submitted !== "submitted") {
    throw new Error(`Cmd+Enter submit was not handled: ${submitted}`);
  }
}

async function waitForQueuedOrForceSentFollowup(marker) {
  await browser.waitUntil(
    async () => {
      const state = await inspectChatState(marker);
      const queuedItems = await execJS(js.queuedItems);
      return (
        state.queuedMessages.some((item) => item.content.includes(marker)) ||
        queuedItems.some((item) => item.text.includes(marker)) ||
        state.chatEvents.some(
          (event) => event.source === "user" && event.displayText.includes(marker)
        )
      );
    },
    {
      timeout: QUEUE_TIMEOUT_MS,
      timeoutMsg: `follow-up marker ${marker} never appeared in queued messages or a force-sent user turn; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function waitForQueuedFollowup(marker) {
  await browser.waitUntil(
    async () => {
      const state = await inspectChatState(marker);
      const queuedItems = await execJS(js.queuedItems);
      return (
        state.queuedMessages.some((item) => item.content.includes(marker)) ||
        queuedItems.some((item) => item.text.includes(marker))
      );
    },
    {
      timeout: QUEUE_TIMEOUT_MS,
      timeoutMsg: `follow-up marker ${marker} never appeared in queued messages; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function clickSendNowForQueuedMarker(marker) {
  const state = await inspectChatState(marker);
  const queuedMessage = state.queuedMessages.find((item) =>
    item.content.includes(marker)
  );
  if (!queuedMessage) {
    const markerUserEvents = state.chatEvents.filter(
      (event) => event.source === "user" && event.displayText.includes(marker)
    );
    if (markerUserEvents.length === 1) return;
    throw new Error(
      `Queued state did not contain marker ${marker}: ${JSON.stringify(summarizeChatState(state))}`
    );
  }
  const previousFlushRequest = state.queueFlushRequest;

  let clicked = null;
  await browser.waitUntil(
    async () => {
      const currentState = await inspectChatState(`${marker}-before-send-now-click`);
      const markerUserEvents = currentState.chatEvents.filter(
        (event) => event.source === "user" && event.displayText.includes(marker)
      );
      if (markerUserEvents.length === 1) {
        clicked = "already-sent";
        return true;
      }
      clicked = await execJS(`
        const item = document.querySelector('[data-testid="queued-message-item"][data-queued-message-id=${JSON.stringify(queuedMessage.id)}]');
        if (!item) return "missing-item";
        const button = item.querySelector('[data-testid="queued-message-send-now"]');
        if (!button) return "missing-button";
        if (button.disabled) return "disabled";
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
        button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
        button.click();
        return "clicked";
      `);
      return clicked === "clicked";
    },
    {
      timeout: 20_000,
      interval: 500,
      timeoutMsg: `Send Now button click failed for marker ${marker}: ${clicked}; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
  if (clicked === "already-sent") return;

  await browser.waitUntil(
    async () => {
      const nextState = await inspectChatState(`${marker}-flush`);
      return nextState.queueFlushRequest > previousFlushRequest;
    },
    {
      timeout: 5_000,
      timeoutMsg: `Send Now did not invoke queue flush for ${marker}; before=${previousFlushRequest} state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );

  await browser.waitUntil(
    async () => {
      const nextState = await inspectChatState(marker);
      const queuedStillContainsMarker = nextState.queuedMessages.some((item) =>
        item.content.includes(marker)
      );
      const markerUserEvents = nextState.chatEvents.filter(
        (event) => event.source === "user" && event.displayText.includes(marker)
      );
      return markerUserEvents.length === 1 && !queuedStillContainsMarker;
    },
    {
      timeout: REPLY_TIMEOUT_MS,
      interval: 1_000,
      timeoutMsg: `Send Now did not consume queue and append user turn for ${marker}; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );

  const finalState = await inspectChatState(marker);
  const markerUserEvents = finalState.chatEvents.filter(
    (event) => event.source === "user" && event.displayText.includes(marker)
  );
  expect(markerUserEvents).toHaveLength(1);
}

async function waitForMarkerReply(marker, label) {
  let lastDiagnostic = null;
  await browser.waitUntil(
    async () => {
      const assistantTexts = await execJS(js.assistantTexts);
      const state = await inspectChatState(`${label}-reply`);
      const assistantEvents = state.chatEvents.filter(
        (event) => event.source === "assistant"
      );
      const visibleSentinel = assistantTexts.some((text) =>
        text.includes("[Request interrupted by user]")
      );
      const eventSentinel = assistantEvents.some((event) =>
        event.displayText.includes("[Request interrupted by user]")
      );
      if (visibleSentinel || eventSentinel) {
        throw new Error(
          `${label} leaked interrupt sentinel; state=${JSON.stringify(summarizeChatState(state))} assistantTexts=${JSON.stringify(assistantTexts.map((text) => truncateDiagnosticText(text)))}`
        );
      }
      lastDiagnostic = {
        state: summarizeChatState(state),
        assistantTexts: assistantTexts.map((text) =>
          truncateDiagnosticText(text)
        ),
      };
      return assistantEvents.some(
        (event) =>
          event.displayVariant === "message" &&
          event.displayText.trim() === marker
      );
    },
    {
      timeout: REPLY_TIMEOUT_MS,
      interval: 2_000,
      timeoutMsg: `${label} follow-up marker never appeared in assistant output; diagnostic=${JSON.stringify(lastDiagnostic)} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );

  const state = await inspectChatState(`${label}-reply-final`);
  const assistantTexts = await execJS(js.assistantTexts);
  const assistantEvents = state.chatEvents.filter(
    (event) => event.source === "assistant"
  );
  const markerAssistantEvents = assistantEvents.filter(
    (event) =>
      event.displayVariant === "message" && event.displayText.trim() === marker
  );
  if (markerAssistantEvents.length !== 1) {
    throw new Error(
      `${label} marker must appear in exactly one assistant message event. markerEvents=${JSON.stringify(
        markerAssistantEvents.map((event) => ({
          id: event.id,
          displayText: truncateDiagnosticText(event.displayText),
        }))
      )} assistantTexts=${JSON.stringify(assistantTexts.map((text) => truncateDiagnosticText(text)))} state=${JSON.stringify(summarizeChatState(state))}`
    );
  }
}

async function waitForIdleSendButton(label) {
  await browser.waitUntil(
    async () => {
      const state = await execJS(js.sendState);
      return state && state.state !== "working";
    },
    {
      timeout: 30_000,
      timeoutMsg: `${label} send button stayed in working state after queued follow-up completed`,
    }
  );
}

function longRunningPromptForConfig(config) {
  return [
    `Start a deliberately long, harmless task for ${config.label}.`,
    "Create a stoppable window by waiting for about 20 seconds before the final answer.",
    "After the wait completes, reply with a short confirmation.",
  ].join(" ");
}

async function runFreshStopRollbackScenario(config) {
  const firstPrompt = longRunningPromptForConfig(config);

  await configureScenario(config);
  const inputSelector = await waitForChatInput();
  await typeAndClickSend(inputSelector, firstPrompt);
  await clickMainAction("stop", `${config.label}-fresh-stop`, 30_000);

  await browser.waitUntil(
    async () => {
      const mode = await execJS(js.mode);
      const editorText = await execJS(js.editorText);
      const state = await inspectChatState(`${config.label}-fresh-stop`);
      return (
        mode === "creator" &&
        typeof editorText === "string" &&
        editorText.includes(firstPrompt.slice(0, 80)) &&
        state.queuedMessages.length === 0
      );
    },
    {
      timeout: 15_000,
      timeoutMsg: `${config.label} fresh Stop did not rollback to creator with prompt restored; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function runStopRestoresInFlightScenario(config) {
  const marker = `QUEUE_STOP_RESTORE_${config.label.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
  const firstPrompt = longRunningPromptForConfig(config);
  const followupPrompt = `Keep this queued while Stop restores the active prompt: ${marker}`;

  await configureScenario(config);
  const inputSelector = await waitForChatInput();
  await typeAndClickSend(inputSelector, firstPrompt);
  await waitForChatLaunched(firstPrompt);
  await waitForWorkingTurn(`${config.label}-stop-restore`);

  const chatInputSelector = await waitForChatInput();
  await typeAndSubmitWithShortcut(chatInputSelector, followupPrompt);
  await waitForQueuedFollowup(marker);
  await clickMainAction("stop", `${config.label}-stop-restore`);
  await browser.waitUntil(
    async () => {
      const state = await inspectChatState(`${config.label}-stop-restore-cancel-started`);
      if (!state.isSessionActive && state.runtimeStatus !== "running") return true;
      if (state.isPendingCancel || state.userInitiatedCancel) return true;
      const sendState = await execJS(js.sendState);
      if (sendState?.state === "stop" && !sendState.disabled) {
        await clickMainAction("stop", `${config.label}-stop-restore-retry`, 2_000).catch(
          () => undefined
        );
      }
      return false;
    },
    {
      timeout: 45_000,
      interval: 1_000,
      timeoutMsg: `${config.label} Stop click did not begin cancellation; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} sendState=${JSON.stringify(await execJS(js.sendState))}`,
    }
  );

  await browser.waitUntil(
    async () => {
      const editorText = await execJS(js.editorText);
      const state = await inspectChatState(`${config.label}-stop-restore`);
      const queuedStillContainsMarker = state.queuedMessages.some((item) =>
        item.content.includes(marker)
      );
      return (
        typeof editorText === "string" &&
        editorText.includes(firstPrompt.slice(0, 80)) &&
        queuedStillContainsMarker
      );
    },
    {
      timeout: 45_000,
      interval: 500,
      timeoutMsg: `${config.label} Stop did not restore in-flight prompt while preserving queue; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function runForceSendScenario(config) {
  const marker = `QUEUE_FORCE_SEND_${config.label.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
  const firstPrompt = longRunningPromptForConfig(config);
  const followupPrompt = `Stop the previous counting task. Reply with exactly this marker and nothing else: ${marker}`;

  await configureScenario(config);
  const inputSelector = await waitForChatInput();
  await typeAndClickSend(inputSelector, firstPrompt);
  await waitForChatLaunched(firstPrompt);
  await waitForWorkingTurn(config.label);

  const chatInputSelector = await waitForChatInput();
  await typeAndClickSend(chatInputSelector, followupPrompt);
  await waitForQueuedOrForceSentFollowup(marker);
  await clickSendNowForQueuedMarker(marker);
  await waitForMarkerReply(marker, config.label);
  await waitForIdleSendButton(config.label);

  const surfaces = await assertStationSurfacesConsistent(
    `${config.label}-force-send`
  );
  if (!surfaces.myStation.roundLabel || !surfaces.agentStation.roundLabel) {
    throw new Error(
      `${config.label} missing rendered round label after Force Send; surfaces=${JSON.stringify(surfaces)}`
    );
  }
  if (/Round\s+1\b/.test(surfaces.myStation.roundLabel)) {
    throw new Error(
      `${config.label} Force Send still rendered only Round 1 after multiple user turns; surfaces=${JSON.stringify(surfaces)}`
    );
  }

  const active = unwrap(
    await invokeE2E("getActiveSessionId"),
    "getActiveSessionId"
  );
  if (!active.sessionId) {
    throw new Error(`${config.label} produced no active session id`);
  }
  expect(active.sessionId).toMatch(config.sessionIdPattern);
  console.log(
    `[queued-followup] ${config.label} session=${active.sessionId} marker=${marker}`
  );
}

export {
  assertStationSurfacesConsistent,
  clickMainAction,
  clickSendNowForQueuedMarker,
  runForceSendScenario,
  runFreshStopRollbackScenario,
  runStopRestoresInFlightScenario,
  waitForIdleSendButton,
  waitForQueuedFollowup,
  waitForWorkingTurn,
};
