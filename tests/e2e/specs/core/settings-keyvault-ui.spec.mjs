/* global describe, before, it */
import {
  invokeE2E,
  unwrap,
  waitForApp,
} from "../../support/core/agentOrgUiDriver.mjs";

const ROUTE = "/orgii/app/settings/integrations/models";
const WAIT_TIMEOUT_MS = 30_000;

async function waitForScript(predicateScript, label, timeout = WAIT_TIMEOUT_MS) {
  await browser.waitUntil(
    async () => browser.executeScript(predicateScript, []),
    { timeout, interval: 250, timeoutMsg: label }
  );
}

async function visibleElementPoint(selector, label) {
  const result = await browser.executeScript(
    `
      const selector = arguments[0];
      const candidates = [...document.querySelectorAll(selector)].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      const element = candidates[0] ?? null;
      if (!element) {
        return {
          found: false,
          selector,
          bodyText: document.body.innerText.slice(0, 2000),
        };
      }
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      const x = Math.floor(rect.left + rect.width / 2);
      const y = Math.floor(rect.top + rect.height / 2);
      const hit = document.elementFromPoint(x, y);
      return {
        found: true,
        selector,
        x,
        y,
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        hitMatches: hit === element || element.contains(hit),
        hit: hit ? {
          tag: hit.tagName,
          className: typeof hit.className === "string" ? hit.className : null,
          testId: hit.getAttribute?.("data-testid") || null,
          dataTabKey: hit.getAttribute?.("data-tab-key") || null,
          text: (hit.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 180),
        } : null,
        text: (element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 180),
      };
    `,
    [selector]
  );
  if (!result.found || result.rect.width <= 0 || result.rect.height <= 0) {
    throw new Error(`${label} not visible: ${JSON.stringify(result, null, 2)}`);
  }
  if (!result.hitMatches) {
    throw new Error(`${label} is covered at click point: ${JSON.stringify(result, null, 2)}`);
  }
  return result;
}

async function pointerClick(selector, label) {
  const point = await visibleElementPoint(selector, label);
  await browser.action("pointer").move({ x: point.x, y: point.y }).down().up().perform();
  return point;
}

async function pointerClickByText(tagName, text, label) {
  const point = await browser.executeScript(
    `
      const tagName = arguments[0].toUpperCase();
      const needle = arguments[1].toLowerCase();
      const element = [...document.querySelectorAll(tagName)].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = window.getComputedStyle(candidate);
        return (candidate.textContent || "").toLowerCase().includes(needle) &&
          rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      if (!element) {
        return { found: false, bodyText: document.body.innerText.slice(0, 2000) };
      }
      element.scrollIntoView({ block: "center", inline: "center" });
      const rect = element.getBoundingClientRect();
      const x = Math.floor(rect.left + rect.width / 2);
      const y = Math.floor(rect.top + rect.height / 2);
      const hit = document.elementFromPoint(x, y);
      return {
        found: true,
        x,
        y,
        rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
        hitMatches: hit === element || element.contains(hit),
        hit: hit ? {
          tag: hit.tagName,
          className: typeof hit.className === "string" ? hit.className : null,
          testId: hit.getAttribute?.("data-testid") || null,
          dataTabKey: hit.getAttribute?.("data-tab-key") || null,
          text: (hit.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 180),
        } : null,
        text: (element.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 180),
      };
    `,
    [tagName, text]
  );
  if (!point.found) {
    throw new Error(`${label} not visible: ${JSON.stringify(point, null, 2)}`);
  }
  if (!point.hitMatches) {
    throw new Error(`${label} is covered at click point: ${JSON.stringify(point, null, 2)}`);
  }
  await browser.action("pointer").move({ x: point.x, y: point.y }).down().up().perform();
  return point;
}

describe("Settings Key Vault UI", () => {
  before(async () => {
    await waitForApp();
  });

  it("opens the Codex account setup from Models & Keys", async () => {
    await browser.executeScript(
      `
        localStorage.setItem("orgii:auth_skipped", "1");
        return true;
      `,
      []
    );
    unwrap(await invokeE2E("navigateTo", ROUTE), "navigate to Models & Keys");

    await waitForScript(
      `return location.pathname === ${JSON.stringify(ROUTE)};`,
      "Models & Keys route did not open"
    );

    await waitForScript(
      `return !!document.querySelector('button[data-tab-key="my-accounts"]');`,
      "My Keys tab did not render"
    );

    await pointerClick('button[data-tab-key="my-accounts"]', "My Keys tab");

    await waitForScript(
      `return document.querySelector('button[data-tab-key="my-accounts"]')?.className.includes("font-semibold");`,
      "My Keys tab did not become active"
    );

    await pointerClickByText("button", "Add Account", "Add Account button");

    await waitForScript(
      `return !!document.querySelector('[data-testid="key-vault-wizard"]');`,
      "Key Vault wizard did not open"
    );

    await waitForScript(
      `return !!document.querySelector('[data-testid="selection-grid-option-openai"]');`,
      "OpenAI provider option did not render"
    );

    await pointerClick('[data-testid="selection-grid-option-openai"]', "OpenAI provider option");

    await waitForScript(
      `return !!document.querySelector('[data-testid="selection-grid-option-codex"]');`,
      "Codex variant option did not render"
    );

    await pointerClick('[data-testid="selection-grid-option-codex"]', "Codex variant option");

    await waitForScript(
      `return document.body.innerText.includes("Sign in") || document.body.innerText.includes("OAuth") || document.body.innerText.includes("ChatGPT") || document.body.innerText.includes("Codex");`,
      "Codex setup did not activate"
    );
  });
});
