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

function thinkingRuntime(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    defaults: { provider: "openai", model: "gpt-5.4" },
    normalizeThinkingLevel: (value: string) => value,
    resolveThinkingPolicy: () => ({ levels: [
      { id: "off", label: "Off" },
      { id: "minimal", label: "Minimal" },
      { id: "adaptive", label: "Adaptive" },
    ] }),
    ...overrides,
  };
}

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
          ...thinkingRuntime(),
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
    assert.equal(request?.thinkLevel, "minimal");
    assert.equal(request?.reasoningLevel, "off");
    assert.equal(request?.disableTools, true);
    assert.deepEqual(request?.toolsAllow, []);
    assert.equal(request?.agentHarnessRuntimeOverride, "codex");
    assert.match(String(request?.sessionKey), /^temp:quick-replies:/u);
    assert.equal((request?.config as typeof config).mcp.servers, undefined);
    assert.equal((request?.config as typeof config).mcp.sessionIdleTtlMs, 60_000);
    assert.deepEqual(config.mcp.servers, { search: { command: "search-mcp" } });
  });

  it("passes a configured thinking level through the embedded-run API", async () => {
    let request: Record<string, unknown> | undefined;
    const host = {
      config: {},
      runtime: {
        agent: {
          ...thinkingRuntime(),
          runEmbeddedAgent: async (value: Record<string, unknown>) => {
            request = value;
            return { payloads: [{ text: '{"eligible":false,"confidence":1,"reason":"status","suggestions":[]}' }] };
          },
        },
      },
    } as unknown as Pick<OpenClawPluginApi, "config" | "runtime">;

    await new ManagedAgentQuickReplyEvaluator(host, { ...DEFAULT_CONFIG, thinkLevel: "adaptive" }).evaluate(input);
    assert.equal(request?.thinkLevel, "adaptive");
  });

  it("validates thinking support against an explicit evaluator model", async () => {
    let policyRequest: Record<string, unknown> | undefined;
    let runs = 0;
    const host = {
      config: {
        plugins: { entries: { "openclaw-quick-replies": { llm: { allowModelOverride: true, allowedModels: ["anthropic/claude-fast"] } } } },
      },
      runtime: {
        agent: {
          ...thinkingRuntime({
            resolveThinkingPolicy: (value: Record<string, unknown>) => {
              policyRequest = value;
              return { levels: [{ id: "minimal", label: "Minimal" }] };
            },
          }),
          runEmbeddedAgent: async () => {
            runs++;
            return { payloads: [] };
          },
        },
      },
    } as unknown as Pick<OpenClawPluginApi, "config" | "runtime">;

    await new ManagedAgentQuickReplyEvaluator(host, { ...DEFAULT_CONFIG, model: "anthropic/claude-fast" }).evaluate(input);
    assert.deepEqual(policyRequest, { provider: "anthropic", model: "claude-fast" });
    assert.equal(runs, 1);
  });

  it("uses the configured host default model for thinking policy validation", async () => {
    let policyRequest: Record<string, unknown> | undefined;
    const host = {
      config: { agents: { defaults: { model: { primary: "google/gemini-fast" } } } },
      runtime: {
        agent: {
          ...thinkingRuntime({
            resolveThinkingPolicy: (value: Record<string, unknown>) => {
              policyRequest = value;
              return { levels: [{ id: "minimal", label: "Minimal" }] };
            },
          }),
          runEmbeddedAgent: async () => ({ payloads: [] }),
        },
      },
    } as unknown as Pick<OpenClawPluginApi, "config" | "runtime">;

    await new ManagedAgentQuickReplyEvaluator(host, DEFAULT_CONFIG).evaluate(input);
    assert.deepEqual(policyRequest, { provider: "google", model: "gemini-fast" });
  });

  it("fails open before starting a run when the thinking level is unsupported or unrecognized", async () => {
    for (const normalizeThinkingLevel of [(value: string) => value, () => undefined]) {
      let runs = 0;
      const host = {
        config: {},
        runtime: {
          agent: {
            ...thinkingRuntime({
              normalizeThinkingLevel,
              resolveThinkingPolicy: () => ({ levels: [{ id: "off", label: "Off" }] }),
            }),
            runEmbeddedAgent: async () => { runs++; return { payloads: [] }; },
          },
        },
      } as unknown as Pick<OpenClawPluginApi, "config" | "runtime">;

      const result = await new ManagedAgentQuickReplyEvaluator(host, DEFAULT_CONFIG).evaluate(input);
      assert.equal(result.failureReason, "evaluator_unsupported_think_level");
      assert.equal(runs, 0);
    }
  });

  it("fails open when runtime thinking-policy helpers are unavailable", async () => {
    let runs = 0;
    const host = {
      config: {},
      runtime: { agent: { defaults: { provider: "openai", model: "gpt-5.4" }, runEmbeddedAgent: async () => { runs++; return { payloads: [] }; } } },
    } as unknown as Pick<OpenClawPluginApi, "config" | "runtime">;

    const result = await new ManagedAgentQuickReplyEvaluator(host, DEFAULT_CONFIG).evaluate(input);
    assert.equal(result.failureReason, "evaluator_unsupported_think_level");
    assert.equal(runs, 0);
  });

  it("passes the caller's cancellation signal to the embedded run", async () => {
    const controller = new AbortController();
    let observed: AbortSignal | undefined;
    const host = {
      config: {},
      runtime: {
        agent: {
          ...thinkingRuntime(),
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
