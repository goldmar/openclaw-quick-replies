import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginHookReplyPayloadSendingContext, PluginHookReplyPayloadSendingEvent } from "openclaw/plugin-sdk/core";
import { createQuickReplyPayloadHook } from "../src/decorator";

const samples = 500;
const api = { pluginConfig: {}, config: {}, runtime: {} } as unknown as OpenClawPluginApi;
const hook = createQuickReplyPayloadHook(api, {
  evaluator: {
    async evaluate() {
      return {
        decision: {
          eligible: true,
          confidence: 1,
          suggestions: [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }],
        },
      };
    },
  },
});

const durations: number[] = [];
for (let index = 0; index < samples; index += 1) {
  const event = {
    kind: "final",
    channel: "telegram",
    payload: { text: `Continue with benchmark run ${index}?` },
  } as unknown as PluginHookReplyPayloadSendingEvent;
  const context = { messageId: `benchmark-${index}`, runId: `benchmark-${index}` } as PluginHookReplyPayloadSendingContext;
  const startedAt = performance.now();
  const result = await hook(event, context);
  durations.push(performance.now() - startedAt);
  if (!result) throw new Error(`benchmark sample ${index} was not decorated`);
}

durations.sort((left, right) => left - right);
const percentile = (fraction: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * fraction))]!;
const round = (value: number) => Math.round(value * 1_000) / 1_000;
console.log(JSON.stringify({
  samples,
  note: "Credential-free plugin overhead with an immediate evaluator stub; excludes provider/model latency.",
  meanMs: round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
  p50Ms: round(percentile(0.5)),
  p95Ms: round(percentile(0.95)),
  maxMs: round(durations.at(-1)!),
}, null, 2));
