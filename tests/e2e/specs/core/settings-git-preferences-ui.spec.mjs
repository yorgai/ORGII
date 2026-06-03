/* global describe, before, after, it */
import {
  invokeE2E,
  unwrap,
  waitForApp,
} from "../../support/core/agentOrgUiDriver.mjs";

const ROUTE = "/orgii/app/settings/integrations/git";
const WAIT_TIMEOUT_MS = 30_000;

let originalWorktreeMaxCount = null;
let originalCleanupIntervalHours = null;

async function waitForScript(predicateScript, label, args = []) {
  let state = null;
  await browser.waitUntil(
    async () => {
      state = await browser.executeScript(predicateScript, args);
      return state === true || state?.ok === true;
    },
    {
      timeout: WAIT_TIMEOUT_MS,
      interval: 250,
      timeoutMsg: `${label}: ${JSON.stringify(state, null, 2)}`,
    }
  );
}

async function pointerClick(selector, label) {
  let point = null;
  await browser.waitUntil(
    async () => {
      point = await browser.executeScript(
        `
          const selector = arguments[0];
          const candidates = [...document.querySelectorAll(selector)].filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
          });
          const element = candidates[candidates.length - 1] ?? null;
          if (!element) {
            return {
              ok: false,
              reason: "missing",
              selector,
              bodyText: document.body.innerText.slice(0, 1600),
              testIds: Array.from(document.querySelectorAll('[data-testid]')).map((item) => item.getAttribute('data-testid')).slice(-80),
            };
          }
          element.scrollIntoView({ block: "center", inline: "center" });
          const rect = element.getBoundingClientRect();
          const x = Math.floor(rect.left + rect.width / 2);
          const y = Math.floor(rect.top + rect.height / 2);
          const hit = document.elementFromPoint(x, y);
          const hitMatches = hit === element || element.contains(hit) || !!hit?.closest?.(selector);
          return {
            ok: hitMatches,
            selector,
            x,
            y,
            rect: { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) },
            hit: hit ? {
              tag: hit.tagName,
              testId: hit.getAttribute?.('data-testid') || null,
              text: hit.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 120) ?? '',
            } : null,
            text: element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 120) ?? '',
          };
        `,
        [selector]
      );
      return point?.ok === true;
    },
    {
      timeout: WAIT_TIMEOUT_MS,
      interval: 250,
      timeoutMsg: `${label} not clickable: ${JSON.stringify(point, null, 2)}`,
    }
  );
  await browser.action("pointer").move({ x: point.x, y: point.y }).down().up().perform();
}

async function selectOption(selectTestId, optionTestId, label) {
  await pointerClick(`[data-testid="${selectTestId}"]`, `${label} select`);
  await pointerClick(`[data-testid="${optionTestId}"]`, `${label} option`);
}

async function readSettings() {
  return unwrap(await invokeE2E("readSettings"), "read settings").settings;
}

async function writeSettingsPartial(partial) {
  unwrap(await invokeE2E("writeSettingsPartial", partial), "write settings partial");
}

async function waitForSettings(expectedMaxCount, expectedCleanupHours) {
  let lastSettings = null;
  await browser.waitUntil(
    async () => {
      lastSettings = await readSettings();
      return (
        lastSettings["git.worktree.maxCount"] === expectedMaxCount &&
        lastSettings["git.worktree.cleanupIntervalHours"] === expectedCleanupHours
      );
    },
    {
      timeout: 10_000,
      interval: 250,
      timeoutMsg: `Git worktree settings did not persist. Last=${JSON.stringify(lastSettings)}`,
    }
  );
}

describe("Settings Git preferences UI", () => {
  before(async () => {
    await waitForApp();
    await browser.executeScript(
      `
        localStorage.setItem("orgii:auth_skipped", "1");
        return true;
      `,
      []
    );
    const settings = await readSettings();
    originalWorktreeMaxCount = settings["git.worktree.maxCount"];
    originalCleanupIntervalHours = settings["git.worktree.cleanupIntervalHours"];
    await writeSettingsPartial({
      "git.worktree.maxCount": 8,
      "git.worktree.cleanupIntervalHours": 6,
    });
  });

  after(async () => {
    if (originalWorktreeMaxCount !== null && originalCleanupIntervalHours !== null) {
      await writeSettingsPartial({
        "git.worktree.maxCount": originalWorktreeMaxCount,
        "git.worktree.cleanupIntervalHours": originalCleanupIntervalHours,
      });
    }
  });

  it("persists rendered Worktree preferences to settings", async () => {
    unwrap(await invokeE2E("navigateTo", ROUTE), "navigate to Git settings");
    await waitForScript(
      `
        return {
          ok: window.location.pathname === arguments[0] &&
            !!document.querySelector('[data-testid="settings-git-worktree-max-count-select"]') &&
            !!document.querySelector('[data-testid="settings-git-worktree-cleanup-interval-select"]'),
          pathname: window.location.pathname,
          bodyText: document.body.innerText.slice(0, 1000),
        };
      `,
      "Git preferences did not render",
      [ROUTE]
    );

    await selectOption(
      "settings-git-worktree-max-count-select",
      "settings-git-worktree-max-count-option-12",
      "Worktree max count"
    );
    await selectOption(
      "settings-git-worktree-cleanup-interval-select",
      "settings-git-worktree-cleanup-interval-option-24",
      "Worktree cleanup interval"
    );

    await waitForSettings(12, 24);

    unwrap(await invokeE2E("navigateTo", "/orgii/app/settings/integrations/models"), "navigate away from Git settings");
    unwrap(await invokeE2E("navigateTo", ROUTE), "navigate back to Git settings");
    await waitForScript(
      `
        const maxText = document.querySelector('[data-testid="settings-git-worktree-max-count-select"]')?.textContent ?? '';
        const cleanupText = document.querySelector('[data-testid="settings-git-worktree-cleanup-interval-select"]')?.textContent ?? '';
        return {
          ok: maxText.includes('12') && cleanupText.includes('24'),
          maxText,
          cleanupText,
        };
      `,
      "Git preferences UI did not reflect persisted settings"
    );
  });
});
