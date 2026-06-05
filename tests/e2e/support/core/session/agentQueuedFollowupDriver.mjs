import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureAuthBypass as ensureBrowserAuthBypass,
  execJS,
  invokeE2E,
  unwrap,
} from "./e2eBrowserHelpers.mjs";

const MOUNT_TIMEOUT_MS = 60_000;
const REPLY_TIMEOUT_MS = Number.parseInt(
  process.env.E2E_REPLY_TIMEOUT_MS ?? "240000",
  10
);
const FIRST_TURN_TIMEOUT_MS = Number.parseInt(
  process.env.E2E_FIRST_TURN_TIMEOUT_MS ?? "60000",
  10
);
const QUEUE_TIMEOUT_MS = 20_000;
const CLAUDE_CODE_ACCOUNT_NAME = process.env.E2E_CLAUDE_CODE_ACCOUNT;
const CLAUDE_CODE_MODEL =
  process.env.E2E_CLAUDE_CODE_MODEL ?? "claude-sonnet-4-6";
const CLAUDE_CODE_MODEL_CHAIN = parseE2EChain(
  process.env.E2E_CLAUDE_CODE_MODEL_CHAIN,
  [CLAUDE_CODE_MODEL]
);
const CLAUDE_CODE_ACCOUNT_CHAIN = parseE2EChain(
  process.env.E2E_CLAUDE_CODE_ACCOUNT_CHAIN,
  [CLAUDE_CODE_ACCOUNT_NAME]
);
const CODEX_ACCOUNT_NAME = process.env.E2E_CODEX_ACCOUNT;
const CODEX_MODEL = process.env.E2E_CODEX_MODEL ?? "gpt-5.5";
const CURSOR_CLI_ACCOUNT_NAME = process.env.E2E_CURSOR_CLI_ACCOUNT;
const CURSOR_CLI_MODEL =
  process.env.E2E_CURSOR_CLI_MODEL ?? "composer-2.5-fast";
const CURSOR_NATIVE_ACCOUNT_NAME = process.env.E2E_CURSOR_NATIVE_ACCOUNT;
const CURSOR_NATIVE_MODEL =
  process.env.E2E_CURSOR_NATIVE_MODEL ?? "composer-2.5-fast";
const GEMINI_ACCOUNT_NAME = process.env.E2E_GEMINI_ACCOUNT;
const DEFAULT_GEMINI_MODEL_CHAIN = [
  process.env.E2E_GEMINI_MODEL,
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-flash-lite",
  "gemini-3-flash-lite-preview",
  "gemini-3-lite",
  "gemini-3-flash-preview",
  "gemini-3-flash",
  "gemini-3.1-flash-preview",
  "gemini-3.1-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-pro",
  "gemini-3.1-pro-preview",
  "gemini-3-pro",
  "gemini-3-pro-preview",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-pro",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.5-pro",
].filter(Boolean);
const GEMINI_MODEL_CHAIN = parseE2EChain(
  process.env.E2E_GEMINI_MODEL_CHAIN,
  DEFAULT_GEMINI_MODEL_CHAIN
);
const GEMINI_ACCOUNT_CHAIN = parseE2EChain(
  process.env.E2E_GEMINI_ACCOUNT_CHAIN,
  [GEMINI_ACCOUNT_NAME]
);
const API_ACCOUNT_NAME = process.env.E2E_OPENAI_ACCOUNT;
const API_MODEL = process.env.E2E_OPENAI_MODEL ?? "op-4.6-relay";
const API_AGENT_TYPE = process.env.E2E_API_AGENT_TYPE ?? "openai_api";
const CLAUDE_CODE_AGENT_TYPE = "claude_code";
const CODEX_AGENT_TYPE = "codex";
const CURSOR_AGENT_TYPE = "cursor_cli";
const GEMINI_AGENT_TYPE = "gemini_cli";
const RUST_AGENT_CATEGORY = "rust_agent";
const CLI_AGENT_CATEGORY = "cli_agent";
const CONTROL_LABEL_FILTER = (process.env.E2E_CONTROL_LABELS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const CONTROL_SCENARIO_FILTER = (process.env.E2E_CONTROL_SCENARIOS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const DEFAULT_REPO_PATH = process.env.E2E_REPO_PATH;
const WORKSTATION_CODE_PATH = "/orgii/workstation/code";
const CHAT_INPUT_SELECTOR =
  '[data-testid="chat-input"] [contenteditable="true"]';

function requireDefaultRepoPath() {
  if (!DEFAULT_REPO_PATH) {
    throw new Error(
      "E2E_REPO_PATH was not initialized. The WDIO runner should create a self-contained fixture repo by default; check tests/e2e/wdio.conf.mjs."
    );
  }
  return DEFAULT_REPO_PATH;
}

function parseE2EChain(rawValue, fallbackValues) {
  const parsed = (rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const source = parsed.length > 0 ? parsed : fallbackValues;
  return Array.from(new Set(source.filter(Boolean)));
}

function isGeminiConfig(config) {
  return config.account?.agent_type === GEMINI_AGENT_TYPE;
}

function isClaudeCodeConfig(config) {
  return config.account?.agent_type === CLAUDE_CODE_AGENT_TYPE;
}

function isGeminiRetryableModelOrCapacityError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("model_capacity_exhausted") ||
    message.includes("capacity") ||
    message.includes("rate limit") ||
    message.includes("rate_limit") ||
    message.includes("overloaded") ||
    message.includes("unavailable") ||
    message.includes("404 not found") ||
    message.includes("model not found") ||
    message.includes("requested entity was not found")
  );
}

function isClaudeCodeTransientAuthError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("oauth refresh failed") ||
    message.includes("refresh token not found or invalid") ||
    message.includes("auth error")
  );
}

function isProviderAccountBlockedError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("auth error") ||
    message.includes("unauthenticated") ||
    message.includes("invalid api key") ||
    message.includes("account disabled") ||
    message.includes("account unavailable")
  );
}

function isProviderNondeterministicMarkerError(error) {
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("marker never appeared in assistant output") ||
    message.includes("follow-up marker never appeared") ||
    message.includes("marker did not appear") ||
    message.includes("marker file was not created")
  );
}

const js = {
  exists: (selector) =>
    `return !!document.querySelector(${JSON.stringify(selector)});`,
  clearAndType: (selector, text) => `
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return "missing";
    element.focus();
    document.execCommand("selectAll", false, null);
    const ok = document.execCommand("insertText", false, ${JSON.stringify(text)});
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(text)} }));
    return ok ? (element.textContent || "") : "insert-failed";
  `,
  click: (selector) => `
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return "missing";
    if (element.disabled) return "disabled";
    element.click();
    return "clicked";
  `,
  visibleClick: (selector) => `
    const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const element = elements.find((candidate) => isVisible(candidate));
    if (!element) return "missing";
    if (element.disabled) return "disabled";
    element.scrollIntoView({ block: "center", inline: "center" });
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
    element.click();
    return "clicked";
  `,
  clickWhenState: (selector, expectedState) => `
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return "missing";
    if (element.disabled) return "disabled";
    const state = element.getAttribute("data-state");
    if (state !== ${JSON.stringify(expectedState)}) return "state:" + String(state);
    element.scrollIntoView({ block: "center", inline: "center" });
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
    element.click();
    return "clicked";
  `,
  sendState: `
    const button = document.querySelector('[data-testid="chat-send-button"]');
    const editor = document.querySelector(${JSON.stringify(CHAT_INPUT_SELECTOR)});
    if (!button) return null;
    return {
      state: button.getAttribute("data-state"),
      disabled: button.disabled,
      editorText: editor ? (editor.textContent || "") : null,
    };
  `,
  editorText: `
    const editor = document.querySelector(${JSON.stringify(CHAT_INPUT_SELECTOR)});
    return editor ? (editor.textContent || "") : null;
  `,
  mode: `
    const creator = document.querySelector(".session-creator-chat-panel");
    const history = document.querySelector('[data-testid="chat-message-list"]');
    return creator ? "creator" : history ? "chat" : "unknown";
  `,
  bodyText: `return document.body.innerText || "";`,
  assistantTexts: `
    return Array.from(document.querySelectorAll('[data-testid="chat-message-assistant"]'))
      .map((node) => (node.textContent || "").trim())
      .filter(Boolean);
  `,
  fileChanges: `
    const filesPill = document.querySelector('[data-testid="composer-section-files"]');
    const undoAll = document.querySelector('[data-testid="file-changes-undo-all"]');
    const redoAll = document.querySelector('[data-testid="file-changes-redo-all"]');
    const keepAll = document.querySelector('[data-testid="file-changes-keep-all"]');
    const review = document.querySelector('[data-testid="file-changes-review"]');
    return {
      filesPill: !!filesPill,
      filesPillText: filesPill ? (filesPill.textContent || '') : '',
      undoAll: !!undoAll,
      undoAllDisabled: !!undoAll && undoAll.disabled,
      redoAll: !!redoAll,
      redoAllDisabled: !!redoAll && redoAll.disabled,
      keepAll: !!keepAll,
      keepAllDisabled: !!keepAll && keepAll.disabled,
      review: !!review,
      reviewDisabled: !!review && review.disabled,
      bodyText: (document.body.innerText || '').slice(0, 3000),
    };
  `,
  renderedSurfaceSnapshot: `
    const isVisible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const firstVisible = (selector) => Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
    const visibleAll = (selector) => Array.from(document.querySelectorAll(selector)).filter(isVisible);
    const filesPill = firstVisible('[data-testid="composer-section-files"]');
    const roundControl = firstVisible('[data-testid="turn-pagination-current-round"]');
    const userMessages = visibleAll('[data-testid="chat-message-user-editable"]');
    const assistantMessages = visibleAll('[data-testid="chat-message-assistant"]');
    const undoAll = firstVisible('[data-testid="file-changes-undo-all"]');
    const redoAll = firstVisible('[data-testid="file-changes-redo-all"]');
    const changesTab = firstVisible('[data-testid="replay-tab-changes"]');
    const changesPanel = firstVisible('[data-testid="replay-changes-panel"]');
    const changesLabel = changesTab ? (changesTab.textContent || '').trim() : '';
    const changesMatch = changesLabel.match(/\((\d+)\)/);
    return {
      filesPill: !!filesPill,
      filesPillText: filesPill ? (filesPill.textContent || '') : '',
      undoAll: !!undoAll,
      redoAll: !!redoAll,
      roundLabel: roundControl ? (roundControl.textContent || '').trim() : '',
      changesLabel,
      changesCount: changesMatch ? Number(changesMatch[1]) : null,
      changesPanelVisible: !!changesPanel,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      bodyText: (document.body.innerText || '').slice(0, 3000),
    };
  `,
  queuedItems: `
    return Array.from(document.querySelectorAll('[data-testid="queued-message-item"]')).map((node) => ({
      id: node.getAttribute('data-queued-message-id') || '',
      text: node.textContent || '',
    }));
  `,
  planUi: `
    const cards = Array.from(document.querySelectorAll('[data-testid="create-plan-card"]'));
    const communicationRoot = document.querySelector('[data-testid="communication-message-viewer"]');
    const chatHistoryRoot = document.querySelector('[data-testid="chat-message-list"]');
    const communicationCards = communicationRoot
      ? Array.from(communicationRoot.querySelectorAll('[data-testid="create-plan-card"], [data-testid="plan-interaction-row"]'))
      : [];
    const communicationPlanRows = communicationRoot
      ? Array.from(communicationRoot.querySelectorAll('[data-testid="plan-interaction-row"]'))
      : [];
    const chatHistoryCards = chatHistoryRoot
      ? Array.from(chatHistoryRoot.querySelectorAll('[data-testid="create-plan-card"]'))
      : [];
    const currentCards = cards.filter((card) => card.getAttribute('data-plan-surface') === 'current');
    const transcriptCards = cards.filter((card) => card.getAttribute('data-plan-surface') === 'transcript');
    const isVisible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const currentDraftCards = currentCards.filter((card) => card.getAttribute('data-plan-ready') !== 'true');
    const planningFooters = Array.from(document.querySelectorAll('[data-testid="planning-footer"]')).filter((footer) => isVisible(footer) && (footer.textContent || '').trim().length > 0);
    const buildButtons = Array.from(document.querySelectorAll('[data-testid="create-plan-build"]'));
    const editButtons = Array.from(document.querySelectorAll('[data-testid="create-plan-edit"]'));
    const planDocPanel = document.querySelector('[data-testid="plan-doc-panel"]');
    const communicationPlanSurfaces = Array.from(document.querySelectorAll('[data-testid="communication-plan-doc-surface"]'));
    const communicationPlanCards = communicationPlanSurfaces.flatMap((surface) => Array.from(surface.querySelectorAll('[data-testid="create-plan-card"], [data-testid="plan-doc-panel"]')));
    const pinnedTodo = document.querySelector('[data-testid="plan-todo-pin-bar"]');
    const todoKanban = document.querySelector('[data-testid="replay-todo-kanban"]');
    const planDocBuild = document.querySelector('[data-testid="plan-doc-build"]');
    const planDocEdit = document.querySelector('[data-testid="plan-doc-edit"]');
    const navigateButtons = cards.flatMap((card) => Array.from(card.querySelectorAll('[data-testid="event-navigate"]')));
    const visibleNavigateButtons = navigateButtons.filter((button) => {
      const style = window.getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    return {
      cardCount: cards.length,
      currentCardCount: currentCards.length,
      transcriptCardCount: transcriptCards.length,
      communicationCardCount: communicationCards.length,
      communicationPlanRowCount: communicationPlanRows.length,
      chatHistoryCardCount: chatHistoryCards.length,
      communicationCardRevisionIds: communicationCards.map((card) => card.getAttribute('data-plan-revision-id') || ''),
      communicationCardStatuses: communicationCards.map((card) => card.getAttribute('data-plan-approval-status') || ''),
      chatHistoryCardRevisionIds: chatHistoryCards.map((card) => card.getAttribute('data-plan-revision-id') || ''),
      chatHistoryCardStatuses: chatHistoryCards.map((card) => card.getAttribute('data-plan-approval-status') || ''),
      readyCardCount: cards.filter((card) => card.getAttribute('data-plan-ready') === 'true').length,
      draftingCardCount: cards.filter((card) => card.getAttribute('data-plan-ready') !== 'true').length,
      readyCurrentCardCount: currentCards.filter((card) => card.getAttribute('data-plan-ready') === 'true').length,
      currentDraftCardCount: currentDraftCards.length,
      currentDraftRevisionIds: currentDraftCards.map((card) => card.getAttribute('data-plan-revision-id') || ''),
      planningFooterCount: planningFooters.length,
      planningFooterTexts: planningFooters.map((footer) => footer.textContent || ''),
      cardTexts: cards.map((card) => card.textContent || ''),
      currentCardTexts: currentCards.map((card) => card.textContent || ''),
      cardEventIds: cards.map((card) => card.closest('[data-tool-call-event-id]')?.getAttribute('data-tool-call-event-id') || ''),
      cardRevisionIds: cards.map((card) => card.getAttribute('data-plan-revision-id') || ''),
      currentCardRevisionIds: currentCards.map((card) => card.getAttribute('data-plan-revision-id') || ''),
      transcriptCardRevisionIds: transcriptCards.map((card) => card.getAttribute('data-plan-revision-id') || ''),
      transcriptCardStatuses: transcriptCards.map((card) => card.getAttribute('data-plan-approval-status') || ''),
      currentCardCollapsedStates: currentCards.map((card) => card.getAttribute('data-plan-collapsed') || ''),
      transcriptCardCollapsedStates: transcriptCards.map((card) => card.getAttribute('data-plan-collapsed') || ''),
      navigateButtonCount: navigateButtons.length,
      visibleNavigateButtonCount: visibleNavigateButtons.length,
      buildButtonCount: buildButtons.length,
      enabledBuildButtonCount: buildButtons.filter((button) => !button.disabled).length,
      enabledBuildRevisionIds: buildButtons
        .filter((button) => !button.disabled)
        .map((button) => button.closest('[data-plan-revision-id]')?.getAttribute('data-plan-revision-id') || '')
        .filter(Boolean),
      editButtonCount: editButtons.length,
      planDocBuild: !!planDocBuild,
      planDocBuildEnabled: !!planDocBuild && !planDocBuild.disabled,
      planDocEdit: !!planDocEdit,
      planDocPanel: !!planDocPanel,
      planDocRevisionId: planDocPanel ? (planDocPanel.getAttribute('data-plan-revision-id') || '') : '',
      planDocText: planDocPanel ? (planDocPanel.textContent || '') : '',
      communicationPlanSurfaceCount: communicationPlanSurfaces.length,
      communicationPlanCardCount: communicationPlanCards.length,
      communicationPlanRowTexts: communicationPlanRows.map((row) => row.textContent || ''),
      communicationPlanTexts: communicationPlanCards.map((card) => card.textContent || ''),
      pinnedTodo: !!pinnedTodo,
      todoKanban: !!todoKanban,
    };
  `,
  modePillText: `
    const pill = document.querySelector('[data-testid="agent-exec-mode-pill"]');
    return pill ? (pill.textContent || '').trim() : null;
  `,
  pageDump: `
    return {
      mode: (() => {
        const creator = document.querySelector(".session-creator-chat-panel");
        const history = document.querySelector('[data-testid="chat-message-list"]');
        return creator ? "creator" : history ? "chat" : "unknown";
      })(),
      sendState: (() => {
        const button = document.querySelector('[data-testid="chat-send-button"]');
        return button ? { state: button.getAttribute("data-state"), disabled: button.disabled } : null;
      })(),
      queuedItems: Array.from(document.querySelectorAll('[data-testid="queued-message-item"]')).map((node) => ({
        id: node.getAttribute('data-queued-message-id') || '',
        text: node.textContent || '',
      })),
      assistantTexts: Array.from(document.querySelectorAll('[data-testid="chat-message-assistant"]')).map((node) => (node.textContent || "").trim()).slice(-3),
      bodyText: (document.body.innerText || "").slice(0, 4000),
    };
  `,
};

async function clickByTestId(testId, label) {
  const result = await browser.executeScript(
    `
      const testId = arguments[0];
      const elements = Array.from(document.querySelectorAll('[data-testid="' + testId + '"]'));
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const visible = elements.filter(isVisible);
      const target = visible.find((element) => !element.disabled);
      if (!target) {
        return {
          ok: false,
          found: elements.length,
          visible: visible.length,
          disabled: visible.filter((element) => element.disabled).length,
        };
      }
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return { ok: true, found: elements.length, visible: visible.length };
    `,
    [testId]
  );
  if (!result?.ok) {
    throw new Error(
      `${label} missing enabled visible [data-testid="${testId}"]; state=${JSON.stringify(result)}`
    );
  }
}

function truncateDiagnosticText(value, maxLength = 180) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function summarizeDiagnosticJson(value, maxLength = 700) {
  if (value == null) return value;
  return truncateDiagnosticText(JSON.stringify(value), maxLength);
}

function summarizeChatState(state) {
  if (!state) return null;
  return {
    activeSessionId: state.activeSessionId,
    runtimeStatus: state.runtimeStatus,
    runtimeError: state.runtimeError,
    stationMode: state.stationMode,
    isSessionActive: state.isSessionActive,
    chatEventCount: state.chatEventCount,
    streamingDelta: state.streamingDelta,
    fileChangesCount: state.fileChangesCount,
    pendingReviewCount: state.pendingReviewCount,
    pendingPlan: state.pendingPlan,
    pinnedTodoCount: state.pinnedTodoCount,
    snapshotCount: state.snapshotCount,
    rawEvents: (state.rawEvents ?? []).map((event) => ({
      id: event.id,
      source: event.source,
      actionType: event.actionType,
      uiCanonical: event.uiCanonical,
      functionName: event.functionName,
      displayText: truncateDiagnosticText(event.displayText),
      resultStatus: event.resultStatus,
      planRevisionId: event.planRevisionId,
      args: summarizeDiagnosticJson(event.args),
      result: summarizeDiagnosticJson(event.result),
    })),
    chatEvents: (state.chatEvents ?? []).map((event) => ({
      id: event.id,
      source: event.source,
      displayVariant: event.displayVariant,
      displayText: truncateDiagnosticText(event.displayText),
    })),
  };
}

function summarizePageDump(dump) {
  if (!dump) return null;
  return {
    mode: dump.mode,
    sendState: dump.sendState,
    queuedItems: dump.queuedItems,
    assistantTexts: (dump.assistantTexts ?? []).map((text) =>
      truncateDiagnosticText(text)
    ),
    bodyText: truncateDiagnosticText(dump.bodyText, 600),
  };
}

function normalizeTranscriptText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function findDuplicateTranscriptEntries(entries) {
  const seen = new Map();
  const duplicates = [];
  for (const entry of entries) {
    const text = normalizeTranscriptText(entry.text);
    if (text.length < 12) continue;
    const key = `${entry.source}:${text}`;
    const existing = seen.get(key);
    if (existing) {
      duplicates.push({ first: existing, second: entry, text });
    } else {
      seen.set(key, entry);
    }
  }
  return duplicates;
}

async function assertNoDuplicateTranscriptMessages(label) {
  const state = await inspectChatState(`${label}-duplicate-transcript-events`);
  const eventById = new Map((state.chatEvents ?? []).map((event) => [event.id, event]));
  const eventEntries = (state.pipelineItems ?? [])
    .map((item) => (item.eventId ? eventById.get(item.eventId) : null))
    .filter(
      (event) =>
        event &&
        (event.source === "user" || event.source === "assistant") &&
        event.displayVariant === "message"
    )
    .map((event) => ({
      id: event.id,
      source: event.source,
      text: event.displayText,
      surface: "event-pipeline",
    }));
  const eventDuplicates = findDuplicateTranscriptEntries(eventEntries);
  if (eventDuplicates.length > 0) {
    throw new Error(
      `${label} duplicate transcript messages in Event pipeline; duplicates=${JSON.stringify(eventDuplicates.slice(0, 3))} state=${JSON.stringify(summarizeChatState(state))}`
    );
  }

  const renderedEntries = await execJS(`
    const isVisible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const entries = [];
    document.querySelectorAll('[data-testid="chat-message-user-editable"]').forEach((node, index) => {
      if (isVisible(node)) entries.push({ source: 'user', id: String(index), text: node.textContent || '', surface: 'rendered' });
    });
    document.querySelectorAll('[data-testid="chat-message-assistant"]').forEach((node, index) => {
      if (isVisible(node)) entries.push({ source: 'assistant', id: String(index), text: node.textContent || '', surface: 'rendered' });
    });
    return entries;
  `);
  const renderedDuplicates = findDuplicateTranscriptEntries(renderedEntries);
  if (renderedDuplicates.length > 0) {
    throw new Error(
      `${label} duplicate visible transcript messages; duplicates=${JSON.stringify(renderedDuplicates.slice(0, 3))} rendered=${JSON.stringify(renderedEntries.map((entry) => ({ ...entry, text: truncateDiagnosticText(entry.text, 160) })))} state=${JSON.stringify(summarizeChatState(state))}`
    );
  }
}

function accountDisplayName(account) {
  return account.name || account.id;
}

function accountMatchesName(account, accountName) {
  return (
    !accountName || account.name === accountName || account.id === accountName
  );
}

function accountMatchesChain(account, accountChain) {
  return accountChain.length === 0
    ? true
    : accountChain.some((accountName) =>
        accountMatchesName(account, accountName)
      );
}

function accountSupportsModel(account, model) {
  return !model || (account.enabled_models ?? []).includes(model);
}

function claudeCodeFallbackConfigs(accounts, baseConfig) {
  if (!isClaudeCodeConfig(baseConfig)) return [];

  const configs = [];
  const seen = new Set([`${baseConfig.account.id}:${baseConfig.model}`]);
  const candidateAccounts = accounts.filter(
    (row) =>
      row.agent_type === CLAUDE_CODE_AGENT_TYPE &&
      row.enabled &&
      row.has_session_token &&
      accountMatchesChain(row, CLAUDE_CODE_ACCOUNT_CHAIN) &&
      (!baseConfig.requiresRustAgentSupport || row.supports_rust_agents)
  );
  for (const account of candidateAccounts) {
    const modelCandidates = Array.from(
      new Set([...CLAUDE_CODE_MODEL_CHAIN, ...(account.enabled_models ?? [])])
    );
    for (const model of modelCandidates) {
      if (!accountSupportsModel(account, model)) continue;
      const key = `${account.id}:${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      configs.push({
        ...baseConfig,
        account,
        model,
      });
    }
  }
  return configs;
}

function geminiFallbackConfigs(accounts, baseConfig) {
  if (!isGeminiConfig(baseConfig)) return [];

  const configs = [];
  const seen = new Set([`${baseConfig.account.id}:${baseConfig.model}`]);
  const candidateAccounts = accounts.filter(
    (row) =>
      row.agent_type === GEMINI_AGENT_TYPE &&
      row.enabled &&
      row.has_session_token &&
      accountMatchesChain(row, GEMINI_ACCOUNT_CHAIN) &&
      (!baseConfig.requiresRustAgentSupport || row.supports_rust_agents)
  );
  for (const account of candidateAccounts) {
    for (const model of GEMINI_MODEL_CHAIN) {
      if (!accountSupportsModel(account, model)) continue;
      const key = `${account.id}:${model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      configs.push({
        ...baseConfig,
        account,
        model,
      });
    }
  }
  return configs;
}

function shouldRunScenario(name) {
  return (
    CONTROL_SCENARIO_FILTER.length === 0 ||
    CONTROL_SCENARIO_FILTER.includes(name)
  );
}

function assertKnownControlScenarios(knownScenarioNames) {
  const knownScenarios = new Set(knownScenarioNames);
  const unknownScenarios = CONTROL_SCENARIO_FILTER.filter(
    (scenarioName) => !knownScenarios.has(scenarioName)
  );
  if (unknownScenarios.length > 0) {
    throw new Error(
      `Unknown E2E_CONTROL_SCENARIOS=${JSON.stringify(unknownScenarios)}; known=${JSON.stringify(Array.from(knownScenarios))}`
    );
  }
}

function assertUniqueConfigLabels(configs, sourceLabel = "configs") {
  const labelCounts = new Map();
  for (const config of configs) {
    labelCounts.set(config.label, (labelCounts.get(config.label) ?? 0) + 1);
  }
  const duplicateLabels = Array.from(labelCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([label, count]) => `${label} x${count}`);
  if (duplicateLabels.length > 0) {
    throw new Error(
      `${sourceLabel} contains duplicate labels: ${duplicateLabels.join(", ")}`
    );
  }
}

function filteredConfigs(configs) {
  assertUniqueConfigLabels(configs, "scenario configs");
  if (CONTROL_LABEL_FILTER.length === 0) return configs;

  const availableLabels = new Set(configs.map((config) => config.label));
  const missingLabels = CONTROL_LABEL_FILTER.filter(
    (label) => !availableLabels.has(label)
  );
  if (missingLabels.length > 0) {
    throw new Error(
      `Requested E2E_CONTROL_LABELS are unavailable: ${missingLabels.join(", ")}; available=${Array.from(availableLabels).join(", ")}`
    );
  }

  const configByLabel = new Map(
    configs.map((config) => [config.label, config])
  );
  return CONTROL_LABEL_FILTER.map((label) => configByLabel.get(label)).filter(
    Boolean
  );
}

async function safePageDump() {
  try {
    return summarizePageDump(await execJS(js.pageDump));
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function ensureAuthBypass() {
  await ensureBrowserAuthBypass(process.env.E2E_BASE_URL ?? "http://127.0.0.1:13847");
}

async function waitForApp() {
  await browser.setTimeout({ script: 3_000 }).catch(() => undefined);
  await browser.setWindowSize(2400, 1200).catch(() => undefined);
  await browser.waitUntil(
    async () => {
      try {
        await ensureAuthBypass();
        return true;
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      interval: 1_000,
      timeoutMsg: `app renderer never accepted readiness script; dump=${JSON.stringify(await safePageDump())}`,
    }
  );
  await browser.pause(500);
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(js.exists('[data-testid="chat-panel"]'));
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      interval: 1_000,
      timeoutMsg: `chat panel never mounted; dump=${JSON.stringify(await safePageDump())}`,
    }
  );
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return !!(window.__e2e && window.__e2e.navigateTo && window.__e2e.configureWithExistingKey && window.__e2e.listAccounts && window.__e2e.resetToNewSession && window.__e2e.inspectChatState && window.__e2e.debugSessionToolsSnapshot);`
        );
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      interval: 1_000,
      timeoutMsg: `required __e2e helpers never mounted; dump=${JSON.stringify(await safePageDump())}`,
    }
  );
}

async function listAccounts() {
  return unwrap(await invokeE2E("listAccounts"), "listAccounts").accounts;
}

function selectModelFromChain(account, modelChain) {
  const model = modelChain.find((candidate) =>
    (account.enabled_models ?? []).includes(candidate)
  );
  if (!model) {
    throw new Error(
      `No model from chain ${JSON.stringify(modelChain)} is enabled for account ${accountDisplayName(account)}; enabled=${JSON.stringify(account.enabled_models ?? [])}`
    );
  }
  return model;
}

function requireGeminiAccountFromChain(
  accounts,
  { requireRustAgentSupport = false } = {}
) {
  const account = accounts.find(
    (row) =>
      row.agent_type === GEMINI_AGENT_TYPE &&
      accountMatchesChain(row, GEMINI_ACCOUNT_CHAIN) &&
      row.enabled &&
      row.has_session_token &&
      (!requireRustAgentSupport || row.supports_rust_agents) &&
      GEMINI_MODEL_CHAIN.some((model) => accountSupportsModel(row, model))
  );
  if (account) return account;

  const rows = accounts
    .filter((row) => row.agent_type === GEMINI_AGENT_TYPE)
    .map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      auth_method: row.auth_method,
      has_session_token: row.has_session_token,
      supports_rust_agents: row.supports_rust_agents,
      enabled_models: row.enabled_models,
    }));
  throw new Error(
    `No Gemini account supports E2E_GEMINI_MODEL_CHAIN=${JSON.stringify(GEMINI_MODEL_CHAIN)} accountChain=${JSON.stringify(GEMINI_ACCOUNT_CHAIN)} requireRustAgentSupport=${requireRustAgentSupport}. Rows=${JSON.stringify(rows)}`
  );
}

function requireClaudeCodeConfigFromChain(
  accounts,
  { requireRustAgentSupport = false } = {}
) {
  const account = accounts.find(
    (row) =>
      row.agent_type === CLAUDE_CODE_AGENT_TYPE &&
      accountMatchesChain(row, CLAUDE_CODE_ACCOUNT_CHAIN) &&
      row.enabled &&
      row.has_session_token &&
      (!requireRustAgentSupport || row.supports_rust_agents) &&
      (row.enabled_models ?? []).length > 0
  );
  if (account) {
    const model =
      CLAUDE_CODE_MODEL_CHAIN.find((candidate) =>
        accountSupportsModel(account, candidate)
      ) ?? account.enabled_models[0];
    return { account, model };
  }

  const rows = accounts
    .filter((row) => row.agent_type === CLAUDE_CODE_AGENT_TYPE)
    .map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      auth_method: row.auth_method,
      has_session_token: row.has_session_token,
      supports_rust_agents: row.supports_rust_agents,
      enabled_models: row.enabled_models,
    }));
  throw new Error(
    `No Claude Code account supports modelChain=${JSON.stringify(CLAUDE_CODE_MODEL_CHAIN)} accountChain=${JSON.stringify(CLAUDE_CODE_ACCOUNT_CHAIN)} requireRustAgentSupport=${requireRustAgentSupport}. Rows=${JSON.stringify(rows)}`
  );
}

function requireAccount(accounts, options) {
  const candidates = accounts.filter((row) => {
    const nameMatches = accountMatchesName(row, options.accountName);
    const modelMatches =
      !options.model || (row.enabled_models ?? []).includes(options.model);
    const apiKeyMatches = !options.requireApiKey || row.has_api_key;
    const sessionTokenMatches =
      !options.requireSessionToken || row.has_session_token;
    const rustAgentMatches =
      !options.requireRustAgentSupport || row.supports_rust_agents;
    return (
      row.agent_type === options.agentType &&
      nameMatches &&
      modelMatches &&
      apiKeyMatches &&
      sessionTokenMatches &&
      rustAgentMatches
    );
  });
  const account = candidates.find((row) => row.enabled) ?? candidates[0];
  if (account) return account;

  const rows = accounts
    .filter((row) => row.agent_type === options.agentType)
    .map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      auth_method: row.auth_method,
      has_api_key: row.has_api_key,
      has_session_token: row.has_session_token,
      supports_rust_agents: row.supports_rust_agents,
      can_use_native_harness: row.can_use_native_harness,
      native_harness_type: row.native_harness_type,
      enabled_models: row.enabled_models,
    }));
  throw new Error(
    `No matching ${options.agentType} account for ${JSON.stringify(options)}. Rows=${JSON.stringify(rows)}`
  );
}

function scenarioConfigs(accounts) {
  const shouldIncludeLabel = (label) =>
    CONTROL_LABEL_FILTER.length === 0 || CONTROL_LABEL_FILTER.includes(label);
  const configs = [];

  if (shouldIncludeLabel("claude-code-cli-agent")) {
    try {
      const { account: claudeCodeAccount, model: claudeCodeModel } =
        requireClaudeCodeConfigFromChain(accounts);
      configs.push({
        label: "claude-code-cli-agent",
        account: claudeCodeAccount,
        model: claudeCodeModel,
        category: CLI_AGENT_CATEGORY,
        cliAgentType: CLAUDE_CODE_AGENT_TYPE,
        sessionIdPattern: /^cliagent-/,
      });
    } catch (error) {
      console.warn(
        `[queued-followup-provider-blocker] label=claude-code-cli-agent unavailable; skipping. error=${String(error?.message ?? error).slice(0, 900)}`
      );
    }
  }

  if (shouldIncludeLabel("claude-code-rust-agent")) {
    try {
      const { account: claudeCodeRustAccount, model: claudeCodeRustModel } =
        requireClaudeCodeConfigFromChain(accounts, {
          requireRustAgentSupport: true,
        });
      configs.push({
        label: "claude-code-rust-agent",
        account: claudeCodeRustAccount,
        model: claudeCodeRustModel,
        category: RUST_AGENT_CATEGORY,
        agentDefinitionId: "builtin:sde",
        requiresRustAgentSupport: true,
        sessionIdPattern: /^sdeagent-|^osagent-|^agent-|^rustagent-/,
      });
    } catch (error) {
      console.warn(
        `[queued-followup-provider-blocker] label=claude-code-rust-agent unavailable; skipping. error=${String(error?.message ?? error).slice(0, 900)}`
      );
    }
  }

  if (shouldIncludeLabel("codex-rust-agent")) {
    const codexRustAccount = requireAccount(accounts, {
      agentType: CODEX_AGENT_TYPE,
      accountName: CODEX_ACCOUNT_NAME,
      model: CODEX_MODEL,
      requireSessionToken: true,
      requireRustAgentSupport: true,
    });
    configs.push({
      label: "codex-rust-agent",
      account: codexRustAccount,
      model: CODEX_MODEL,
      category: RUST_AGENT_CATEGORY,
      agentDefinitionId: "builtin:sde",
      sessionIdPattern: /^sdeagent-|^osagent-|^agent-|^rustagent-/,
    });
  }

  if (shouldIncludeLabel("codex-cli-agent")) {
    const codexAccount = requireAccount(accounts, {
      agentType: CODEX_AGENT_TYPE,
      accountName: CODEX_ACCOUNT_NAME,
      model: CODEX_MODEL,
      requireSessionToken: true,
    });
    configs.push({
      label: "codex-cli-agent",
      account: codexAccount,
      model: CODEX_MODEL,
      category: CLI_AGENT_CATEGORY,
      cliAgentType: CODEX_AGENT_TYPE,
      sessionIdPattern: /^cliagent-/,
    });
  }

  if (shouldIncludeLabel("cursor-native-rust-agent")) {
    const cursorNativeAccount = requireAccount(accounts, {
      agentType: CURSOR_AGENT_TYPE,
      accountName: CURSOR_NATIVE_ACCOUNT_NAME,
      model: CURSOR_NATIVE_MODEL,
      requireSessionToken: true,
      requireRustAgentSupport: true,
    });
    configs.push({
      label: "cursor-native-rust-agent",
      account: cursorNativeAccount,
      model: CURSOR_NATIVE_MODEL,
      category: RUST_AGENT_CATEGORY,
      agentDefinitionId: "builtin:sde",
      nativeHarnessType: "cursor_native",
      sessionIdPattern: /^sdeagent-|^osagent-|^agent-|^rustagent-/,
    });
  }

  if (shouldIncludeLabel("cursor-cli-agent")) {
    const cursorCliCandidates = accounts.filter(
      (row) =>
        row.agent_type === CURSOR_AGENT_TYPE &&
        row.enabled &&
        row.has_api_key &&
        (row.enabled_models ?? []).length > 0 &&
        (!CURSOR_CLI_ACCOUNT_NAME ||
          row.name === CURSOR_CLI_ACCOUNT_NAME ||
          row.id === CURSOR_CLI_ACCOUNT_NAME)
    );
    if (cursorCliCandidates.length > 0) {
      const cursorCliAccount = cursorCliCandidates[0];
      const cursorCliModel = (cursorCliAccount.enabled_models ?? []).includes(
        CURSOR_CLI_MODEL
      )
        ? CURSOR_CLI_MODEL
        : cursorCliAccount.enabled_models[0];
      configs.push({
        label: "cursor-cli-agent",
        account: cursorCliAccount,
        model: cursorCliModel,
        category: CLI_AGENT_CATEGORY,
        cliAgentType: CURSOR_AGENT_TYPE,
        sessionIdPattern: /^cliagent-/,
      });
    } else {
      console.log(
        "[queued-followup] Cursor CLI account with API key not found; skipping cursor-cli-agent row."
      );
    }
  }

  if (shouldIncludeLabel("gemini-rust-agent")) {
    const geminiRustAccount = requireGeminiAccountFromChain(accounts, {
      requireRustAgentSupport: true,
    });
    const geminiRustModel = selectModelFromChain(
      geminiRustAccount,
      GEMINI_MODEL_CHAIN
    );
    configs.push({
      label: "gemini-rust-agent",
      account: geminiRustAccount,
      model: geminiRustModel,
      category: RUST_AGENT_CATEGORY,
      agentDefinitionId: "builtin:sde",
      requiresRustAgentSupport: true,
      fallbackConfigs: [],
      sessionIdPattern: /^sdeagent-|^osagent-|^agent-|^rustagent-/,
    });
  }

  if (shouldIncludeLabel("gemini-cli-agent")) {
    const geminiCliAccount = requireGeminiAccountFromChain(accounts);
    const geminiCliModel = selectModelFromChain(
      geminiCliAccount,
      GEMINI_MODEL_CHAIN
    );
    configs.push({
      label: "gemini-cli-agent",
      account: geminiCliAccount,
      model: geminiCliModel,
      category: CLI_AGENT_CATEGORY,
      cliAgentType: GEMINI_AGENT_TYPE,
      fallbackConfigs: [],
      sessionIdPattern: /^cliagent-/,
    });
  }

  if (shouldIncludeLabel("openai-api-rust-agent")) {
    try {
      const apiRustAccount = requireAccount(accounts, {
        agentType: API_AGENT_TYPE,
        accountName: API_ACCOUNT_NAME,
        model: API_MODEL,
        requireApiKey: true,
        requireRustAgentSupport: true,
      });
      configs.push({
        label: "openai-api-rust-agent",
        account: apiRustAccount,
        model: API_MODEL,
        category: RUST_AGENT_CATEGORY,
        agentDefinitionId: "builtin:sde",
        defaultRepoPath: requireDefaultRepoPath(),
        sessionIdPattern: /^sdeagent-|^osagent-|^agent-|^rustagent-/,
      });
    } catch (error) {
      console.warn(
        `[queued-followup-provider-blocker] label=openai-api-rust-agent unavailable; skipping. error=${String(error?.message ?? error).slice(0, 900)}`
      );
    }
  }

  for (const config of configs) {
    if (isClaudeCodeConfig(config)) {
      config.fallbackConfigs = claudeCodeFallbackConfigs(accounts, config);
      console.log(
        `[queued-followup-claude-code-chain] label=${config.label} primary=${accountDisplayName(config.account)}:${config.model} fallbacks=${JSON.stringify(
          config.fallbackConfigs.map(
            (fallbackConfig) =>
              `${accountDisplayName(fallbackConfig.account)}:${fallbackConfig.model}`
          )
        )} chain=${JSON.stringify(CLAUDE_CODE_ACCOUNT_CHAIN)}`
      );
    }
    if (isGeminiConfig(config)) {
      config.fallbackConfigs = geminiFallbackConfigs(accounts, config);
      console.log(
        `[queued-followup-gemini-chain] label=${config.label} primary=${accountDisplayName(config.account)}:${config.model} fallbacks=${JSON.stringify(
          config.fallbackConfigs.map(
            (fallbackConfig) =>
              `${accountDisplayName(fallbackConfig.account)}:${fallbackConfig.model}`
          )
        )}`
      );
    }
  }

  return configs;
}

async function waitForChatInput() {
  await browser.waitUntil(
    async () => execJS(js.exists('[data-testid="chat-panel"]')),
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: "chat panel never mounted",
    }
  );
  await browser.waitUntil(async () => execJS(js.exists(CHAT_INPUT_SELECTOR)), {
    timeout: MOUNT_TIMEOUT_MS,
    timeoutMsg: "chat input never mounted",
  });
  return CHAT_INPUT_SELECTOR;
}

async function typeAndClickSend(inputSelector, prompt) {
  const typed = await execJS(js.clearAndType(inputSelector, prompt));
  if (!typed.includes(prompt))
    throw new Error(`Failed to type prompt: ${typed}`);
  await browser.pause(500);
  await browser.waitUntil(
    async () => {
      const state = await execJS(js.sendState);
      return state && state.state === "submit" && !state.disabled;
    },
    {
      timeout: 15_000,
      timeoutMsg: `send button never became submit after typing ${JSON.stringify(prompt.slice(0, 80))}; sendState=${JSON.stringify(await execJS(js.sendState))}; active=${JSON.stringify(await invokeE2E("getActiveSessionId"))}; chat=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}; dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
  const clicked = await execJS(js.click('[data-testid="chat-send-button"]'));
  if (clicked !== "clicked") {
    const state = await execJS(js.sendState);
    throw new Error(
      `send click failed: ${clicked}; state=${JSON.stringify(state)}`
    );
  }
}

async function selectConfiguredWorkspaceIfNeeded(repoPath) {
  if (!repoPath) return;
  const result = await execJS(`
    const repoPath = ${JSON.stringify(repoPath)};
    const repoName = repoPath.split(/[\\/]/).filter(Boolean).pop() || repoPath;
    const bodyText = document.body.innerText || "";
    const inWorkspaceSelector = bodyText.includes("Select a workspace") || bodyText.includes("Create Multi-repo Workspace");
    if (!inWorkspaceSelector) return { attempted: false, clicked: false, reason: "not-selector" };
    const isVisible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const matches = Array.from(document.querySelectorAll("div, button"))
      .filter(isVisible)
      .filter((node) => {
        const text = node.textContent || "";
        return text.includes(repoPath) || text.includes(repoName);
      })
      .sort((left, right) => (left.textContent || "").length - (right.textContent || "").length);
    const matched = matches[0] || null;
    const target = matched?.closest(".cursor-pointer") || matched;
    if (!target) return { attempted: true, clicked: false, reason: "missing", repoName, bodyText: bodyText.slice(0, 1000) };
    target.scrollIntoView({ block: "center", inline: "center" });
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
    target.click();
    return { attempted: true, clicked: true, repoName, text: (target.textContent || "").slice(0, 200) };
  `);
  if (result?.attempted && !result.clicked) {
    throw new Error(
      `configured workspace was not selectable: ${JSON.stringify(result)}`
    );
  }
}

async function waitForSessionCreatorReady(label, repoPath) {
  await browser.waitUntil(
    async () => {
      await selectConfiguredWorkspaceIfNeeded(repoPath);
      const mode = await execJS(js.mode);
      const sendState = await execJS(js.sendState);
      return mode === "creator" && sendState?.state === "submit";
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      interval: 500,
      timeoutMsg: `${label} session creator never became ready; dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function stopActiveTurnIfNeeded(label) {
  const sendState = await execJS(js.sendState).catch(() => null);
  const mode = await execJS(js.mode).catch(() => "unknown");
  if (mode !== "chat" || sendState?.state !== "stop") return;
  const clicked = await execJS(js.click('[data-testid="chat-send-button"]'));
  if (clicked !== "clicked") {
    throw new Error(
      `${label} failed to stop active turn before reconfigure: ${clicked}`
    );
  }
  await browser.waitUntil(
    async () => {
      const nextState = await execJS(js.sendState).catch(() => null);
      return nextState?.state !== "stop";
    },
    {
      timeout: 30_000,
      timeoutMsg: `${label} active turn did not stop before reconfigure; dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function configureScenario(config, overrides = {}) {
  await stopActiveTurnIfNeeded(`${config.label}-preconfigure`);
  await ensureAuthBypass();
  unwrap(
    await invokeE2E("navigateTo", WORKSTATION_CODE_PATH),
    "navigateTo workstation code"
  );
  await ensureAuthBypass();
  unwrap(await invokeE2E("resetToNewSession"), "resetToNewSession");
  const configured = unwrap(
    await invokeE2E("configureWithExistingKey", {
      accountName: accountDisplayName(config.account),
      model: config.model,
      agentType: config.account.agent_type,
      category: config.category,
      cliAgentType: config.cliAgentType,
      agentDefinitionId: config.agentDefinitionId,
      nativeHarnessType: config.nativeHarnessType,
      agentExecMode: overrides.agentExecMode ?? "build",
      repoPath:
        overrides.repoPath ??
        config.defaultRepoPath ??
        requireDefaultRepoPath(),
    }),
    `configureWithExistingKey(${config.label})`
  );
  expect(configured.modelId).toBe(config.model);
  await waitForSessionCreatorReady(
    `${config.label}-configured`,
    overrides.repoPath ?? config.defaultRepoPath ?? requireDefaultRepoPath()
  );
}

async function assertSingleUserPromptInActiveTranscript(firstPrompt) {
  const promptPrefix = firstPrompt.slice(0, 120);
  const state = await inspectChatState("single-user-prompt-check");
  const eventById = new Map((state.chatEvents ?? []).map((event) => [event.id, event]));
  const visibleEvents = (state.pipelineItems ?? [])
    .map((item) => (item.eventId ? eventById.get(item.eventId) : null))
    .filter(Boolean);
  const matchingUserEvents = visibleEvents.filter(
    (event) =>
      event.source === "user" &&
      event.displayVariant === "message" &&
      String(event.displayText ?? "").includes(promptPrefix)
  );
  if (matchingUserEvents.length > 1) {
    throw new Error(
      `duplicate user prompt detected in active transcript; count=${matchingUserEvents.length} promptPrefix=${JSON.stringify(promptPrefix)} state=${JSON.stringify(summarizeChatState(state))}`
    );
  }
}

async function waitForChatLaunched(firstPrompt) {
  await browser.waitUntil(
    async () => {
      const mode = await execJS(js.mode);
      const body = await execJS(js.bodyText);
      return mode === "chat" && body.includes(firstPrompt.slice(0, 80));
    },
    {
      timeout: FIRST_TURN_TIMEOUT_MS,
      timeoutMsg: `first prompt did not launch a chat session; mode=${JSON.stringify(await execJS(js.mode))}; active=${JSON.stringify(await invokeE2E("getActiveSessionId"))}; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))}; creator=${JSON.stringify(await invokeE2E("inspectCreatorSelection"))}; sendState=${JSON.stringify(await execJS(js.sendState))}; dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
  await assertSingleUserPromptInActiveTranscript(firstPrompt);
  await assertNoDuplicateTranscriptMessages("first-launch");
}

async function waitForActiveSession(label) {
  await browser.waitUntil(
    async () => {
      const active = unwrap(
        await invokeE2E("getActiveSessionId"),
        `${label}-getActiveSessionId`
      );
      return !!active.sessionId;
    },
    {
      timeout: FIRST_TURN_TIMEOUT_MS,
      interval: 1_000,
      timeoutMsg: `${label} did not create an active session; state=${JSON.stringify(summarizeChatState(await invokeE2E("inspectChatState")))} creator=${JSON.stringify(await invokeE2E("inspectCreatorSelection"))} sendState=${JSON.stringify(await execJS(js.sendState))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function inspectChatState(label) {
  return unwrap(
    await invokeE2E("inspectChatState"),
    `inspectChatState(${label})`
  );
}

function rustAgentConfigs(configs) {
  return configs.filter((config) => config.category === RUST_AGENT_CATEGORY);
}

async function readCurrentModeFromMenu(label) {
  const skillsToolsButtonSelector = '[data-testid="composer-skills-tools-button"]';
  const flyoutTriggerSelector = '[data-testid="slash-command-mode-flyout-trigger"]';
  let triggerText = await execJS(`
    const node = document.querySelector('[data-testid="slash-command-mode-flyout-trigger"]');
    return node ? (node.textContent || '').trim() : null;
  `);
  if (!triggerText) {
    const opened = await execJS(js.visibleClick(skillsToolsButtonSelector));
    if (opened !== "clicked") {
      return { ok: false, reason: `skills/tools open failed: ${opened}` };
    }
    await browser.waitUntil(async () => execJS(js.exists(flyoutTriggerSelector)), {
      timeout: 5_000,
      timeoutMsg: `${label} slash command Mode flyout trigger never rendered`,
    });
    triggerText = await execJS(`
      const node = document.querySelector('[data-testid="slash-command-mode-flyout-trigger"]');
      return node ? (node.textContent || '').trim() : null;
    `);
  }
  return { ok: true, triggerText };
}

async function waitForModePill(label, expectedText) {
  await browser.waitUntil(
    async () => {
      const text = await execJS(js.modePillText);
      if (typeof text === "string" && text.includes(expectedText)) return true;
      const menuMode = await readCurrentModeFromMenu(label);
      return menuMode.ok && String(menuMode.triggerText ?? "").includes(expectedText);
    },
    {
      timeout: 15_000,
      timeoutMsg: `${label} mode selector never showed ${expectedText}; actual=${JSON.stringify(await execJS(js.modePillText))} menu=${JSON.stringify(await readCurrentModeFromMenu(label).catch((error) => ({ ok: false, reason: String(error?.message ?? error) })))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
}

async function assertProgressUiSettledAfterAssistantReply(label, expectedText) {
  await browser.waitUntil(
    async () => {
      const state = await inspectChatState(`${label}-assistant-reply`);
      return (state.chatEvents ?? []).some(
        (event) =>
          event.source === "assistant" &&
          event.displayVariant === "message" &&
          String(event.displayText ?? "").includes(expectedText)
      );
    },
    {
      timeout: REPLY_TIMEOUT_MS,
      interval: 2_000,
      timeoutMsg: `${label} assistant reply ${JSON.stringify(expectedText)} never appeared; state=${JSON.stringify(summarizeChatState(await inspectChatState(`${label}-assistant-reply-timeout`)))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );

  const ui = await execJS(js.planUi);
  if ((ui.planningFooterCount ?? 0) > 0) {
    throw new Error(
      `${label} still showed planning footer after assistant reply; ui=${JSON.stringify(ui)} state=${JSON.stringify(summarizeChatState(await inspectChatState(`${label}-planning-after-reply`)))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(js.sendState);
      return state?.state !== "stop";
    },
    {
      timeout: 15_000,
      interval: 500,
      timeoutMsg: `${label} send button stayed in stop state after assistant reply; sendState=${JSON.stringify(await execJS(js.sendState))} state=${JSON.stringify(summarizeChatState(await inspectChatState(`${label}-stop-after-reply`)))} dump=${JSON.stringify(summarizePageDump(await execJS(js.pageDump)))}`,
    }
  );
  await assertNoDuplicateTranscriptMessages(label);
}

export {
  CODEX_AGENT_TYPE,
  CONTROL_LABEL_FILTER,
  QUEUE_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  assertKnownControlScenarios,
  assertNoDuplicateTranscriptMessages,
  assertProgressUiSettledAfterAssistantReply,
  assertUniqueConfigLabels,
  clickByTestId,
  configureScenario,
  execJS,
  filteredConfigs,
  inspectChatState,
  invokeE2E,
  isClaudeCodeConfig,
  isClaudeCodeTransientAuthError,
  isGeminiConfig,
  isGeminiRetryableModelOrCapacityError as isGeminiTransientCapacityError,
  isProviderAccountBlockedError,
  isProviderNondeterministicMarkerError,
  js,
  listAccounts,
  rustAgentConfigs,
  scenarioConfigs,
  shouldRunScenario,
  stopActiveTurnIfNeeded,
  summarizeChatState,
  summarizePageDump,
  truncateDiagnosticText,
  typeAndClickSend,
  unwrap,
  waitForActiveSession,
  waitForApp,
  waitForChatInput,
  waitForChatLaunched,
  waitForModePill,
};
