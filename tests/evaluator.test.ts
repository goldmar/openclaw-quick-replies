import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { DEFAULT_CONFIG } from "../src/config";
import { configWithoutUserMcpServers, ManagedAgentQuickReplyEvaluator } from "../src/evaluator";

const input = {
  text: "Continue?",
  channel: "telegram" as const,
  maxSuggestions: 6,
  maxLabelChars: 24,
  maxValueBytes: 42,
};

describe("managed evaluator", () => {
  it("runs a raw, tool-free Codex model call without projecting user MCP servers", async () => {
    let request: Record<string, unknown> | undefined;
    const config = {
      mcp: { servers: { search: { command: "search-mcp" } }, sessionIdleTtlMs: 60_000 },
      plugins: {
        entries: {
          "openclaw-quick-replies": {
            llm: { allowModelOverride: true, allowedModels: ["openai/gpt-5.6-luna"] },
          },
        },
      },
    };
    const host = {
      config,
      runtime: {
        agent: {
          runEmbeddedAgent: async (value: Record<string, unknown>) => {
            request = value;
            return {
              payloads: [{ text: '{"eligible":true,"confidence":0.99,"reason":"answer requested","suggestions":[{"label":"Yes","value":"Yes"},{"label":"No","value":"No"}]}' }],
            };
          },
        },
      },
    } as unknown as Pick<OpenClawPluginApi, "config" | "runtime">;

    const evaluator = new ManagedAgentQuickReplyEvaluator(host, {
      ...DEFAULT_CONFIG,
      model: "openai/gpt-5.6-luna",
    });
    const result = await evaluator.evaluate(input);

    assert.equal(result.decision?.eligible, true);
    assert.equal(request?.modelRun, true);
    assert.equal(request?.disableTools, true);
    assert.deepEqual(request?.toolsAllow, []);
    assert.equal(request?.agentHarnessRuntimeOverride, "codex");
    assert.match(String(request?.sessionKey), /^temp:quick-replies:/u);
    assert.equal((request?.config as typeof config).mcp.servers, undefined);
    assert.equal((request?.config as typeof config).mcp.sessionIdleTtlMs, 60_000);
    assert.deepEqual(config.mcp.servers, { search: { command: "search-mcp" } });
  });

  it("passes the caller's cancellation signal to the embedded run", async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const host = {
      config: {},
      runtime: {
        agent: {
          runEmbeddedAgent: async (request: Record<string, unknown>) => {
            observed = request.abortSignal as AbortSignal;
            return { payloads: [{ text: '{"eligible":false,"confidence":1,"reason":"status","suggestions":[]}' }] };
          },
        },
      },
    } as unknown as Pick<OpenClawPluginApi, "config" | "runtime">;

    await new ManagedAgentQuickReplyEvaluator(host, DEFAULT_CONFIG).evaluate({ ...input, abortSignal: controller.signal });
    assert.equal(observed, controller.signal);
  });
});

describe("MCP config projection", () => {
  it("returns untouched configs when no user MCP servers are present", () => {
    const config = { mcp: { sessionIdleTtlMs: 60_000 } };
    assert.equal(configWithoutUserMcpServers(config), config);
    assert.equal(configWithoutUserMcpServers(null), null);
  });
});
