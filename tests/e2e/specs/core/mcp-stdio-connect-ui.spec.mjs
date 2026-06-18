/**
 * mcp-stdio-connect-ui.spec.mjs
 *
 * Regression coverage for "some stdio MCP servers (e.g. codegraph) won't
 * connect, with an opaque error".
 *
 * The fix: stdio MCP failures are now diagnosable — the command is resolved
 * against PATH (a missing binary yields "not found in PATH" instead of an
 * opaque timeout), and the child's stderr is captured into the surfaced error.
 *
 * Rendered/bridge, no-LLM coverage (window.__e2e, mirrors custom-config-ui):
 *  - (a) A working Node stdio JSON-RPC stub → mcpListServers shows it
 *        `connected` after reconnect (proves stdio still works).
 *  - (b) A bogus command that does not exist on PATH → the server's surfaced
 *        error contains "not found in PATH" (the real diagnostic, NOT a
 *        generic timeout). This is the core fix.
 *
 * Snapshots global MCP config in `before`, restores it in `after`.
 */

const MOUNT_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 30_000;
const RUN_ID = Date.now();

const GOOD_SERVER = `e2e-stdio-good-${RUN_ID}`;
const GOOD_TOOL = `e2e_stdio_tool_${RUN_ID}`;
const BAD_SERVER = `e2e-stdio-bad-${RUN_ID}`;
const BOGUS_COMMAND = `orgii-nonexistent-mcp-binary-${RUN_ID}`;

let originalMcpConfig = null;

const GOOD_STUB_SOURCE = `const toolName = ${JSON.stringify(GOOD_TOOL)};
let buffer = "";
function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.method === "initialize") {
      send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "orgii-e2e-stdio", version: "1.0.0" } } });
    } else if (request.method === "tools/list") {
      send({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: toolName, description: "E2E stdio tool", inputSchema: { type: "object", properties: {} } }] } });
    } else if (request.method === "tools/call") {
      send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "ok" }] } });
    } else if (request.id !== undefined) {
      send({ jsonrpc: "2.0", id: request.id, result: {} });
    }
  }
});`;

async function execJS(script) {
  return browser.executeScript(script, []);
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
    Promise.resolve(window.__e2e[method].apply(null, rest))
      .then(cb)
      .catch((e) => cb({ ok: false, error: String(e && e.message || e) }));
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

function findServer(servers, name) {
  return (servers ?? []).find((s) => s && s.name === name) ?? null;
}

async function waitForFrontendReady() {
  const port = process.env.E2E_FRONTEND_PORT ?? "1998";
  const url = `http://127.0.0.1:${port}`;
  await browser.waitUntil(
    async () => {
      try {
        const response = await fetch(url, { method: "GET" });
        return response.ok;
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: `frontend dev server never became ready at ${url}`,
    }
  );
}

async function waitForApp() {
  await waitForFrontendReady();
  await browser.setTimeout({ script: 10_000 });
  await execJS(`localStorage.setItem('orgii:auth_skipped', '1'); return true;`);
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return document.readyState === 'complete' || document.readyState === 'interactive';`
        );
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: "app document never became script-readable",
    }
  );
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return !!(window.__e2e && window.__e2e.mcpGetConfig && window.__e2e.mcpUpdateServers && window.__e2e.mcpListServers && window.__e2e.mcpReconnectServer);`
        );
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: "window.__e2e MCP helpers never became available",
    }
  );
}

describe("stdio MCP connect + diagnosable failures", () => {
  before(async () => {
    await waitForApp();
    originalMcpConfig = unwrap(
      await invokeE2E("mcpGetConfig", "global"),
      "snapshot original MCP config"
    ).config;

    unwrap(
      await invokeE2E(
        "mcpUpdateServers",
        {
          mcpServers: {
            ...(originalMcpConfig.mcpServers ?? {}),
            [GOOD_SERVER]: {
              type: "stdio",
              command: "node",
              args: ["-e", GOOD_STUB_SOURCE],
              disabled: false,
              timeout: 10,
            },
            [BAD_SERVER]: {
              type: "stdio",
              command: BOGUS_COMMAND,
              args: [],
              disabled: false,
              timeout: 10,
            },
          },
        },
        "global"
      ),
      "seed good + bad stdio MCP servers"
    );
  });

  after(async () => {
    if (originalMcpConfig) {
      await invokeE2E(
        "mcpUpdateServers",
        { mcpServers: originalMcpConfig.mcpServers ?? {} },
        "global"
      );
    }
  });

  it("connects a working stdio MCP stub", async () => {
    await invokeE2E("mcpReconnectServer", GOOD_SERVER);
    await browser.waitUntil(
      async () => {
        const res = await invokeE2E("mcpListServers");
        if (!res || res.ok !== true) return false;
        const server = findServer(res.servers, GOOD_SERVER);
        return server && server.status === "connected";
      },
      {
        timeout: CONNECT_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: `good stdio MCP server '${GOOD_SERVER}' never reached connected`,
      }
    );
  });

  it("surfaces a 'not found in PATH' diagnostic for a missing command", async () => {
    // Use the "Test" path (mcpTestServer), which returns the connection
    // diagnostic as DATA (success:false, error:"...") rather than rejecting —
    // the same path the Integrations UI "Test" button exercises.
    await browser.setTimeout({ script: 30_000 });
    const res = unwrap(
      await invokeE2E("mcpTestServer", BAD_SERVER, {
        type: "stdio",
        command: BOGUS_COMMAND,
        args: [],
        disabled: false,
        timeout: 10,
      }),
      "mcpTestServer(bad command)"
    );
    const result = res.result ?? {};
    const surfaced = String(result.error ?? "");

    // The core fix: an actionable diagnostic, NOT a generic timeout.
    if (result.success !== false) {
      throw new Error(
        `expected the bogus command to fail, got ${JSON.stringify(result)}`
      );
    }
    if (!/not found in PATH/i.test(surfaced)) {
      throw new Error(
        `expected a 'not found in PATH' diagnostic, got: ${JSON.stringify(surfaced)}`
      );
    }
    // Negative (Rule 9): the surfaced error must NOT be the old opaque timeout.
    if (/timed out after/i.test(surfaced)) {
      throw new Error(
        `expected a PATH diagnostic, got a generic timeout: ${surfaced}`
      );
    }
  });
});
