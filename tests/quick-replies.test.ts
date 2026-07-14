import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookReplyPayloadSendingContext,
  PluginHookReplyPayloadSendingEvent,
} from "openclaw/plugin-sdk/core";
import { createQuickReplyPayloadHook } from "../src/decorator";
import type { QuickReplyEvaluationResult, QuickReplyEvaluator } from "../src/types";

function api(pluginConfig: Record<string, unknown> = {}): OpenClawPluginApi {
  return { pluginConfig, config: {}, runtime: {} } as unknown as OpenClawPluginApi;
}

function event(text: string, channel = "telegram", extra: Record<string, unknown> = {}): PluginHookReplyPayloadSendingEvent {
  return { kind: "final", channel, payload: { text }, ...extra } as unknown as PluginHookReplyPayloadSendingEvent;
}

const context = { messageId: "message-1", runId: "run-1" } as PluginHookReplyPayloadSendingContext;

function eligible(values = ["Yes", "No"]): QuickReplyEvaluationResult {
  return {
    decision: {
      eligible: true,
      confidence: 0.99,
      suggestions: values.map((value) => ({ label: value, value })),
    },
  };
}

describe("reply payload decoration", () => {
  it("routes Telegram only and suppresses Discord and unknown channels", async () => {
    let calls = 0;
    const hook = createQuickReplyPayloadHook(api(), { evaluator: { async evaluate() { calls++; return eligible(); } } });
    assert.ok(await hook(event("Continue?"), context));
    assert.equal(await hook(event("Continue?", "discord"), context), undefined);
    assert.equal(await hook(event("Continue?", "webchat"), context), undefined);
    assert.equal(calls, 1);
  });

  it("invokes the evaluator only for questions, answer requests, and explicit lists", async () => {
    let calls = 0;
    const hook = createQuickReplyPayloadHook(api(), { evaluator: { async evaluate() { calls++; return eligible(); } } });
    assert.equal(await hook(event("Deployment completed successfully."), context), undefined);
    assert.equal(await hook(event("The answer is ready."), context), undefined);
    assert.ok(await hook(event("Should I deploy?"), { ...context, messageId: "m2" }));
    assert.ok(await hook(event("Reply with yes or no."), { ...context, messageId: "m3" }));
    assert.ok(await hook(event("Choose one:\n1. Yes\n2. No"), { ...context, messageId: "m4" }));
    assert.equal(calls, 3);
  });

  it("fails open after the configured evaluator timeout", async () => {
    const evaluator: QuickReplyEvaluator = { evaluate: async () => new Promise(() => {}) };
    const hook = createQuickReplyPayloadHook(api({ evaluationTimeoutMs: 100 }), { evaluator });
    const started = Date.now();
    assert.equal(await hook(event("Continue?"), context), undefined);
    assert.ok(Date.now() - started < 500);
  });

  it("deduplicates concurrent evaluations and caches results for identical input", async () => {
    let calls = 0;
    let release!: (result: QuickReplyEvaluationResult) => void;
    const pending = new Promise<QuickReplyEvaluationResult>((resolve) => { release = resolve; });
    const hook = createQuickReplyPayloadHook(api(), {
      evaluator: { async evaluate() { calls++; return pending; } },
    });
    const first = hook(event("Continue?"), context);
    const second = hook(event("Continue?"), context);
    await Promise.resolve();
    assert.equal(calls, 1);
    release(eligible());
    assert.deepEqual(await first, await second);
    await hook(event("Continue?"), { ...context, messageId: "another-message" });
    assert.equal(calls, 2);
  });

  it("isolates the cache by message text, model, and relevant configuration", async () => {
    let calls = 0;
    const host = api();
    const hook = createQuickReplyPayloadHook(host, { evaluator: { async evaluate() { calls++; return eligible(); } } });
    await hook(event("Continue?"), context);
    await hook(event("Proceed?"), context);
    host.pluginConfig = { model: "openai/model-a" };
    await hook(event("Continue?"), context);
    host.pluginConfig = { model: "openai/model-a", maxSuggestions: 4 };
    await hook(event("Continue?"), context);
    assert.equal(calls, 4);
  });

  it("requires complete explicit option sets", async () => {
    const text = "Choose a target:\n1. Staging\n2. Production\n3. Cancel";
    const incomplete = createQuickReplyPayloadHook(api(), { evaluator: { async evaluate() { return eligible(["Staging", "Production"]); } } });
    assert.equal(await incomplete(event(text), context), undefined);

    const complete = createQuickReplyPayloadHook(api(), { evaluator: { async evaluate() { return eligible(["Staging", "Production", "Cancel"]); } } });
    const result = await complete(event(text), context);
    const buttons = result?.payload?.presentation?.blocks.find((block) => block.type === "buttons");
    assert.equal(buttons?.type, "buttons");
    assert.deepEqual(buttons?.type === "buttons" ? buttons.buttons.map((button) => button.label) : [], ["Staging", "Production", "Cancel"]);
    assert.ok(buttons?.type === "buttons" && buttons.buttons.every((button) => button.action?.type === "callback"));
  });

  it("suppresses existing controls and ignores undocumented metadata quick replies", async () => {
    let calls = 0;
    const hook = createQuickReplyPayloadHook(api(), { evaluator: { async evaluate() { calls++; return eligible(); } } });
    const interactive = event("Continue?");
    interactive.payload.presentation = { blocks: [{ type: "buttons", buttons: [{ label: "Core", value: "core:ok" }] }] };
    assert.equal(await hook(interactive, context), undefined);
    assert.equal(calls, 0);

    const metadata = event("Continue?");
    (metadata.payload as unknown as Record<string, unknown>).metadata = { quickReplies: [{ label: "Injected", value: "Injected" }] };
    const result = await hook(metadata, context);
    assert.ok(result);
    assert.equal(calls, 1);
  });
});
