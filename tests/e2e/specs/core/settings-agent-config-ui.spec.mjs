/* global describe, before, it */
import {
  invokeE2E,
  unwrap,
  waitForApp,
} from "../../support/core/agentOrgUiDriver.mjs";

const ROUTE = "/orgii/app/settings/agent-orgs/agents";
const WAIT_TIMEOUT_MS = 30_000;

async function waitForScript(predicateScript, label, timeout = WAIT_TIMEOUT_MS) {
  await browser.waitUntil(
    async () => browser.executeScript(predicateScript, []),
    { timeout, interval: 250, timeoutMsg: label }
  );
}

async function pointerClick(selector, label) {
  const point = await browser.executeScript(
    `
      const selector = arguments[0];
      const candidates = [...document.querySelectorAll(selector)].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      const element = candidates[0] ?? null;
      if (!element) {
        return { found: false, selector, bodyText: document.body.innerText.slice(0, 2000) };
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
    [selector]
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

describe("Settings Agent configuration UI", () => {
  before(async () => {
    await waitForApp();
  });

  it("opens OS Agent configuration and switches config tabs", async () => {
    await browser.executeScript(
      `
        localStorage.setItem("orgii:auth_skipped", "1");
        return true;
      `,
      []
    );
    unwrap(await invokeE2E("navigateTo", ROUTE), "navigate to Agent settings");

    await waitForScript(
      `return !!document.querySelector('[data-testid="agent-orgs-agent-row-builtin:os"]');`,
      "OS Agent row did not render after navigating to Agent settings"
    );

    await pointerClick('[data-testid="agent-orgs-agent-row-builtin:os"]', "OS Agent row");

    await waitForScript(
      `return !!document.querySelector('[data-testid="agent-orgs-builtin-detail-os"]');`,
      "OS Agent detail panel did not open"
    );

    await waitForScript(
      `return !!document.querySelector('[data-testid="agent-orgs-detail-tab-models"]');`,
      "Agent detail tabs did not render"
    );

    await pointerClick('[data-testid="agent-orgs-detail-tab-models"]', "Models tab");

    await waitForScript(
      `return document.querySelector('[data-testid="agent-orgs-detail-tab-models"]')?.className.includes("font-semibold");`,
      "Models tab did not become active"
    );

    await pointerClick('[data-testid="agent-orgs-detail-tab-rules"]', "Rules tab");

    await waitForScript(
      `return document.querySelector('[data-testid="agent-orgs-detail-tab-rules"]')?.className.includes("font-semibold");`,
      "Rules tab did not become active"
    );
  });
});
