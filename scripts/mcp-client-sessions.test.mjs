import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { register } from "node:module";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
register("./test-alias-loader.mjs", import.meta.url);

const { callMcpTool, testMcp, discoverMcpTools, inspectMcpDefinitions } =
  await import("../lib/mcp/client.ts");

async function startSessionServer() {
  const transports = new Map();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
    const sessionId = req.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport && req.method === "POST" && isInitializeRequest(body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => transports.set(sid, transport),
      });
      transport.onclose = () => transports.delete(transport.sessionId);
      const mcp = new McpServer({ name: "test", version: "0.0.0" });
      mcp.registerTool("ping", { description: "ping" }, async () => ({
        content: [{ type: "text", text: JSON.stringify({ ok: true }) }],
      }));
      await mcp.connect(transport);
    }
    if (!transport) {
      res.writeHead(400).end();
      return;
    }
    await transport.handleRequest(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return { url, transports, close: () => new Promise((r) => server.close(r)) };
}

test("short-lived MCP helpers terminate their server-side sessions", async () => {
  const fixture = await startSessionServer();
  try {
    const connection = { url: fixture.url, headers: {} };
    assert.deepEqual(await callMcpTool(connection, "ping"), { ok: true });
    assert.equal(fixture.transports.size, 0, "callMcpTool leaked a session");
    assert.equal((await testMcp(connection)).ok, true);
    assert.equal(fixture.transports.size, 0, "testMcp leaked a session");
    assert.equal((await discoverMcpTools(connection)).length, 1);
    assert.equal(fixture.transports.size, 0, "discoverMcpTools leaked a session");
    assert.equal((await inspectMcpDefinitions("test", connection)).success, true);
    assert.equal(fixture.transports.size, 0, "inspectMcpDefinitions leaked a session");
  } finally {
    await fixture.close();
  }
});
