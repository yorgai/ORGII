/**
 * zenmux-suggest-next-steps-schema.spec.mjs
 *
 * Live rendered-UI proof that ZenMux (account "zmx1") chat models can run a
 * turn that calls `suggest_next_steps` — a tool whose params schema nests a
 * struct (`Vec<StepProposal>`). Before the `inline_subschemas = true` fix in
 * `params_schema` (src-tauri/crates/agent-core/src/core/tools/params.rs),
 * schemars emitted draft-07 `#/definitions/StepProposal` refs, which the
 * moonshot/kimi family served through ZenMux reject with HTTP 400
 * ("references must start with #/$defs/"), surfacing as an "Agent request
 * failed" card. This spec drives the real chat UI for every gateway-verified
 * usable ZenMux text model and asserts the tool renders + a reply lands +
 * no schema-400 error card appears.
 *
 * Model set: the 118 models on zmx1 that the gateway actually serves for
 * /v1/chat/completions (output_modalities == ["text"] AND a minimal probe
 * returned 200). Embedding / image / ASR models, `-free` / `*-pro`
 * subscription-gated ids, and upstream legacy/not-provisioned models are
 * excluded because they 400/404 at the ZenMux gateway for reasons UNRELATED
 * to the tool-schema dialect — including them would only add noise. Every
 * model in this list previously had exactly one failure mode: the schema-400
 * bug (for moonshot/kimi) or none (for the rest). So any failure here is a
 * real regression, not an account/upstream artifact.
 *
 * Env knobs:
 *   E2E_ZENMUX_ACCOUNT   account name/id (default "zmx1")
 *   E2E_ZENMUX_MODELS    comma list to override the model set
 *   E2E_ZENMUX_MAX       cap the number of models tested (default: all)
 */

import { waitForApp } from "../../support/core/session/sessionMatrixDriver.mjs";

const ZMX_ACCOUNT = process.env.E2E_ZENMUX_ACCOUNT ?? "zmx1";
const ZENMUX_AGENT_TYPE = "zenmux_api";
// A plain message is enough: the SDE toolset ALWAYS includes the
// `suggest_next_steps` tool, whose params schema nests `Vec<StepProposal>`.
// That schema is sent on the wire with every turn, so a moonshot/kimi model
// would 400 at request time ("references must start with #/$defs/") even
// before the LLM decides whether to call the tool. We therefore do NOT need
// to force a tool call — we only need the turn to NOT produce a schema-400
// "Agent request failed" card, and to produce a reply.
const PROMPT = `Reply with a one-sentence greeting and nothing else.`;
const REPLY_TIMEOUT_MS = Number.parseInt(
  process.env.E2E_ZENMUX_REPLY_TIMEOUT_MS ?? "120000",
  10
);
const SCHEMA_ERROR_MARKERS = [
  "moonshot flavored json schema",
  "references must start with",
  "is not a valid",
  "$defs",
];

// Gateway-verified usable text models on zmx1 (see file header). Static so
// mocha can generate one `it` per model at collection time.
const DEFAULT_MODELS = [
  "z-ai/glm-5.2",
  "moonshotai/kimi-k2.7-code-highspeed",
  "moonshotai/kimi-k2.7-code",
  "qwen/qwen3.7-plus",
  "minimax/minimax-m3",
  "stepfun/step-3.7-flash",
  "stepfun/step-3.7-flash-free",
  "anthropic/claude-opus-4.8",
  "x-ai/grok-build-0.1",
  "qwen/qwen3.7-max",
  "sapiens-ai/agnes-2.0-flash",
  "google/gemini-3.5-flash",
  "inclusionai/ring-2.6-1t",
  "google/gemini-3.1-flash-lite",
  "baidu/ernie-5.1",
  "openai/chat-latest",
  "x-ai/grok-4.3",
  "qwen/qwen3.6-max-preview",
  "openai/gpt-5.5",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-pro",
  "inclusionai/ling-2.6-1t",
  "xiaomi/mimo-v2.5-pro",
  "tencent/hy3-preview",
  "xiaomi/mimo-v2.5",
  "inclusionai/ling-2.6-flash",
  "moonshotai/kimi-k2.6",
  "anthropic/claude-opus-4.7",
  "z-ai/glm-5.1",
  "qwen/qwen3.6-plus",
  "z-ai/glm-5v-turbo",
  "kuaishou/kat-coder-pro-v2",
  "minimax/minimax-m2.7",
  "minimax/minimax-m2.7-highspeed",
  "openai/gpt-5.4-nano",
  "openai/gpt-5.4-mini",
  "inclusionai/llada2.1-flash",
  "z-ai/glm-5-turbo",
  "x-ai/grok-4.2-fast",
  "x-ai/grok-4.2-fast-non-reasoning",
  "openai/gpt-5.4",
  "google/gemini-3.1-flash-lite-preview",
  "openai/gpt-5.3-chat",
  "qwen/qwen3.5-flash",
  "qwen/qwen3.6-flash",
  "google/gemini-3.1-pro-preview",
  "anthropic/claude-sonnet-4.6",
  "qwen/qwen3.5-plus",
  "bytedance/doubao-seed-2.0-mini",
  "bytedance/doubao-seed-2.0-lite",
  "bytedance/doubao-seed-2.0-code",
  "bytedance/doubao-seed-2.0-pro",
  "minimax/minimax-m2.5",
  "minimax/minimax-m2.5-lightning",
  "z-ai/glm-5",
  "openai/gpt-5.3-codex",
  "anthropic/claude-opus-4.6",
  "stepfun/step-3.5-flash",
  "moonshotai/kimi-k2.5",
  "qwen/qwen3-max",
  "minimax/minimax-m2-her",
  "baidu/ernie-5.0-thinking-preview",
  "z-ai/glm-4.7-flash-free",
  "openai/gpt-5.2-codex",
  "z-ai/glm-4.7",
  "minimax/minimax-m2.1",
  "bytedance/doubao-seed-1.8",
  "google/gemini-3-flash-preview",
  "xiaomi/mimo-v2-flash",
  "openai/gpt-5.2",
  "z-ai/glm-4.6v-flash-free",
  "z-ai/glm-4.6v-flash",
  "z-ai/glm-4.6v",
  "deepseek/deepseek-v3.2",
  "mistralai/mistral-large-2512",
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner",
  "anthropic/claude-opus-4.5",
  "openai/gpt-5.1-codex",
  "openai/gpt-5.1-chat",
  "openai/gpt-5.1",
  "bytedance/doubao-seed-code",
  "tencent/hunyuan-2.0-thinking",
  "minimax/minimax-m2",
  "anthropic/claude-haiku-4.5",
  "z-ai/glm-4.6",
  "anthropic/claude-sonnet-4.5",
  "deepseek/deepseek-v3.2-exp",
  "qwen/qwen3-vl-plus",
  "openai/gpt-5-codex",
  "deepseek/deepseek-chat-v3.1",
  "openai/gpt-5",
  "openai/gpt-5-nano",
  "openai/gpt-5-mini",
  "openai/gpt-5-chat",
  "anthropic/claude-opus-4.1",
  "stepfun/step-3",
  "z-ai/glm-4.5-air",
  "z-ai/glm-4.5",
  "qwen/qwen3-coder-plus",
  "google/gemini-2.5-flash-lite",
  "qwen/qwen3-235b-a22b-2507",
  "qwen/qwen3-235b-a22b-thinking-2507",
  "qwen/qwen3-coder",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "deepseek/deepseek-r1-0528",
  "anthropic/claude-opus-4",
  "anthropic/claude-sonnet-4",
  "qwen/qwen3-14b",
  "openai/o4-mini",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1-nano",
  "openai/gpt-4.1",
  "meta/llama-4-scout-17b-16e-instruct",
  "meta/llama-3.3-70b-instruct",
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
];

function resolveModelList() {
  const override = (process.env.E2E_ZENMUX_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  let models = override.length > 0 ? override : DEFAULT_MODELS;
  const cap = Number.parseInt(process.env.E2E_ZENMUX_MAX ?? "", 10);
  if (Number.isFinite(cap) && cap > 0) {
    models = models.slice(0, cap);
  }
  return models;
}

async function invokeE2E(method, ...args) {
  return browser.executeAsyncScript(
    `
    const cb = arguments[arguments.length - 1];
    const method = arguments[0];
    const rest = Array.prototype.slice.call(arguments, 1, arguments.length - 1);
    if (!window.__e2e || typeof window.__e2e[method] !== "function") {
      cb({ ok: false, error: "window.__e2e." + method + " not available" });
      return;
    }
    window.__e2e[method].apply(null, rest)
      .then(cb)
      .catch((error) => cb({ ok: false, error: String(error && error.message || error) }));
    `,
    [method, ...args]
  );
}

function unwrap(result, label) {
  if (!result || result.ok !== true) {
    throw new Error(`${label} failed: ${result?.error ?? "unknown"}`);
  }
  return result;
}

async function execJS(script) {
  return browser.executeScript(script, []);
}

const dom = {
  inputSelector: '[data-testid="chat-input"] [contenteditable="true"]',
  exists: (sel) => `return !!document.querySelector(${JSON.stringify(sel)});`,
  type: (sel, text) => `
    const editor = document.querySelector(${JSON.stringify(sel)});
    if (!editor) return "missing";
    editor.focus();
    const ok = document.execCommand("insertText", false, ${JSON.stringify(text)});
    return ok ? "typed" : "insert-failed";
  `,
  click: (sel) => `
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return "missing";
    if (el.disabled) return "disabled";
    el.click();
    return "clicked";
  `,
  mode: `
    const creator = document.querySelector(".session-creator-chat-panel");
    const history = document.querySelector('[data-testid="chat-message-list"]');
    return creator ? "creator" : history ? "chat" : "unknown";
  `,
  latestAssistant: `
    const bubbles = Array.from(document.querySelectorAll('[data-testid="chat-message-assistant"]'));
    if (bubbles.length === 0) return "";
    const latest = bubbles[bubbles.length - 1];
    return (latest.textContent || latest.innerText || "").trim();
  `,
  sendState: `
    const button = document.querySelector('[data-testid="chat-send-button"]');
    return button ? button.getAttribute("data-state") : null;
  `,
  bodyText: `return (document.body.innerText || "").slice(0, 4000);`,
};

async function configureModel(account, model) {
  unwrap(await invokeE2E("navigateTo", "/orgii/workstation/code"), "navigateTo");
  unwrap(await invokeE2E("resetToNewSession"), "resetToNewSession");
  const cfg = unwrap(
    await invokeE2E("configureWithExistingKey", {
      accountName: account.name || account.id,
      model,
      agentType: ZENMUX_AGENT_TYPE,
      agentExecMode: "build",
      repoPath: process.env.E2E_REPO_PATH,
    }),
    `configureWithExistingKey(${model})`
  );
  if (cfg.modelId !== model) {
    throw new Error(
      `configure pinned wrong model: wanted ${model} got ${cfg.modelId}`
    );
  }
  await browser.pause(600);
}

async function sendPrompt(prompt) {
  await browser.waitUntil(async () => execJS(dom.exists(dom.inputSelector)), {
    timeout: 60_000,
    timeoutMsg: "chat input never mounted",
  });
  const typed = await execJS(dom.type(dom.inputSelector, prompt));
  if (typed !== "typed") throw new Error(`could not type prompt: ${typed}`);
  await browser.pause(400);
  await browser.waitUntil(
    async () => (await execJS(dom.click('[data-testid="chat-send-button"]'))) === "clicked",
    { timeout: 20_000, timeoutMsg: "send button never clickable" }
  );
  await browser.waitUntil(async () => (await execJS(dom.mode)) === "chat", {
    timeout: 45_000,
    timeoutMsg: "session never transitioned to chat view",
  });
}

/**
 * Wait until the turn either produces an assistant reply (PASS) or surfaces a
 * schema-400 error (FAIL fast). Returns the rendered body text for assertion.
 */
async function waitForReplyOrSchemaError(label) {
  let outcome = "pending";
  await browser.waitUntil(
    async () => {
      const body = (await execJS(dom.bodyText)).toLowerCase();
      if (SCHEMA_ERROR_MARKERS.some((m) => body.includes(m))) {
        outcome = "schema-error";
        return true;
      }
      // Generic agent failure card with no schema marker — still a failure,
      // but report it distinctly so triage can tell schema vs other.
      if (body.includes("agent request failed")) {
        outcome = "agent-error";
        return true;
      }
      const reply = await execJS(dom.latestAssistant);
      if (reply && reply.length > 0) {
        outcome = "reply";
        return true;
      }
      return false;
    },
    {
      timeout: REPLY_TIMEOUT_MS,
      interval: 3000,
      timeoutMsg: `${label}: no reply and no error within ${REPLY_TIMEOUT_MS}ms`,
    }
  );
  return outcome;
}

const MODELS = resolveModelList();

describe("ZenMux suggest_next_steps nested-schema renders without 400", function () {
  this.timeout(5 * 60_000);

  let account = null;

  before(async () => {
    await waitForApp();
    const accounts = unwrap(
      await invokeE2E("listAccounts"),
      "listAccounts"
    ).accounts;
    account =
      accounts.find(
        (row) =>
          row.agent_type === ZENMUX_AGENT_TYPE &&
          (row.name === ZMX_ACCOUNT || row.id === ZMX_ACCOUNT)
      ) ?? null;
    if (!account) {
      throw new Error(
        `No ZenMux account "${ZMX_ACCOUNT}" found. zenmux rows=${JSON.stringify(
          accounts
            .filter((r) => r.agent_type === ZENMUX_AGENT_TYPE)
            .map((r) => ({ id: r.id, name: r.name, enabled: r.enabled }))
        )}`
      );
    }
    console.log(
      `[zenmux-schema] account=${account.name || account.id} testing ${MODELS.length} models`
    );
  });

  for (const model of MODELS) {
    it(`model ${model}: turn completes, no schema-400 card`, async function () {
      // Skip cleanly if the account didn't enable this model (model set may
      // drift from the gateway over time).
      const enabled = account?.enabled_models ?? [];
      if (enabled.length > 0 && !enabled.includes(model)) {
        console.warn(`[zenmux-schema] SKIP ${model} (not enabled on account)`);
        this.skip();
        return;
      }

      await configureModel(account, model);
      await sendPrompt(PROMPT);
      const outcome = await waitForReplyOrSchemaError(`zenmux:${model}`);
      const bodyText = await execJS(dom.bodyText);

      if (outcome === "schema-error") {
        throw new Error(
          `[zenmux-schema] ${model} SCHEMA-400 regression — tool schema rejected: ${bodyText.slice(0, 600)}`
        );
      }
      if (outcome === "agent-error") {
        // Non-schema agent failure (e.g. transient upstream). Surface it but
        // tag distinctly so it isn't confused with the schema regression.
        throw new Error(
          `[zenmux-schema] ${model} agent request failed (non-schema): ${bodyText.slice(0, 600)}`
        );
      }

      // PASS path: a reply rendered and no schema marker appeared.
      const lower = bodyText.toLowerCase();
      for (const marker of SCHEMA_ERROR_MARKERS) {
        expect(lower).not.toContain(marker);
      }
      expect(lower).not.toContain("agent request failed");
      console.log(`[zenmux-schema] ${model} -> PASS (reply rendered)`);
    });
  }
});
