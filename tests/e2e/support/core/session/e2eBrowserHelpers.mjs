export async function execJS(script) {
  return browser.executeScript(script, []);
}

export async function invokeE2E(method, ...args) {
  const invocationId = `e2e-invoke-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const startState = await browser.executeScript(
    `
      const invocationId = arguments[0];
      const method = arguments[1];
      const rest = Array.prototype.slice.call(arguments, 2);
      window.__orgiiE2EInvocations = window.__orgiiE2EInvocations || {};
      if (!window.__e2e || typeof window.__e2e[method] !== "function") {
        window.__orgiiE2EInvocations[invocationId] = {
          done: true,
          result: { ok: false, error: "window.__e2e method unavailable: " + method },
        };
        return { started: false };
      }
      window.__orgiiE2EInvocations[invocationId] = { done: false };
      Promise.resolve(window.__e2e[method].apply(null, rest))
        .then((result) => {
          window.__orgiiE2EInvocations[invocationId] = { done: true, result };
        })
        .catch((error) => {
          window.__orgiiE2EInvocations[invocationId] = {
            done: true,
            result: { ok: false, error: String(error && error.message ? error.message : error) },
          };
        });
      return { started: true };
    `,
    [invocationId, method, ...args]
  );

  if (startState?.started !== true) {
    return browser.executeScript(
      `
        const invocationId = arguments[0];
        const entry = window.__orgiiE2EInvocations && window.__orgiiE2EInvocations[invocationId];
        if (!entry || !entry.done) return { ok: false, error: "invokeE2E did not start" };
        delete window.__orgiiE2EInvocations[invocationId];
        return entry.result;
      `,
      [invocationId]
    );
  }

  let result = null;
  await browser.waitUntil(
    async () => {
      result = await browser.executeScript(
        `
          const invocationId = arguments[0];
          const entry = window.__orgiiE2EInvocations && window.__orgiiE2EInvocations[invocationId];
          if (!entry || !entry.done) return { done: false };
          delete window.__orgiiE2EInvocations[invocationId];
          return { done: true, result: entry.result };
        `,
        [invocationId]
      );
      return result?.done === true;
    },
    {
      timeout: 60_000,
      interval: 250,
      timeoutMsg: `window.__e2e.${method} did not resolve`,
    }
  );
  return result.result;
}

export function unwrap(result, label) {
  if (!result || result.ok !== true) {
    throw new Error(`${label} failed: ${result?.error ?? "unknown"}`);
  }
  return result;
}

export async function ensureAuthBypass(baseUrl) {
  await execJS(`
    localStorage.setItem("orgii:auth_skipped", "1");
    localStorage.setItem("orgii:e2eBaseUrl", ${JSON.stringify(baseUrl)});
    if (location.pathname.includes("login")) {
      location.reload();
    }
    return true;
  `);
}

export function providerBlockedText(response) {
  return `${JSON.stringify(response ?? {})} ${String(response?.message ?? response ?? "")}`.toLowerCase();
}
