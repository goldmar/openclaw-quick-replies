import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import plugin from "../index";
import { DEFAULT_CONFIG, QUICK_REPLY_THINK_LEVELS, resolveQuickReplyConfig, validateEvaluatorDecision } from "../src/config";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "openclaw.plugin.json"), "utf8"));

describe("public configuration", () => {
  it("keeps the ClawHub and runtime display names aligned", () => {
    assert.equal(manifest.name, "Quick Replies");
    assert.equal(plugin.name, manifest.name);
  });

  it("keeps runtime and manifest defaults aligned", () => {
    const properties = manifest.configSchema.properties;
    for (const key of [
      "enabled",
      "maxSuggestions",
      "minConfidence",
      "thinkLevel",
      "maxInputChars",
      "maxLabelChars",
      "maxValueBytes",
      "evaluationTimeoutMs",
      "updateChecks",
    ] as const) {
      assert.equal(properties[key].default, DEFAULT_CONFIG[key]);
    }
    assert.equal(properties.maxSuggestions.type, "integer");
    assert.equal(properties.maxInputChars.type, "integer");
    assert.equal(properties.maxLabelChars.type, "integer");
    assert.equal(properties.maxValueBytes.type, "integer");
    assert.equal(properties.evaluationTimeoutMs.type, "integer");
    assert.equal(DEFAULT_CONFIG.evaluationTimeoutMs, 20_000);
    assert.equal(DEFAULT_CONFIG.thinkLevel, "minimal");
    assert.deepEqual(properties.thinkLevel.enum, QUICK_REPLY_THINK_LEVELS);
  });

  it("clamps integers and normalizes the model override", () => {
    assert.deepEqual(resolveQuickReplyConfig({
      enabled: false,
      maxSuggestions: 99,
      minConfidence: -1,
      model: "  openai/example  ",
      thinkLevel: "high",
      maxInputChars: 99_999,
      maxLabelChars: 99,
      maxValueBytes: 99,
      evaluationTimeoutMs: 99_999,
      updateChecks: false,
    }), {
      enabled: false,
      maxSuggestions: 10,
      minConfidence: 0,
      model: "openai/example",
      thinkLevel: "high",
      maxInputChars: 12_000,
      maxLabelChars: 64,
      maxValueBytes: 42,
      evaluationTimeoutMs: 30_000,
      updateChecks: false,
    });
  });

  it("accepts every embedded-run thinking level and defaults invalid or omitted values", () => {
    for (const thinkLevel of QUICK_REPLY_THINK_LEVELS) {
      assert.equal(resolveQuickReplyConfig({ thinkLevel }).thinkLevel, thinkLevel);
    }
    assert.equal(resolveQuickReplyConfig({}).thinkLevel, "minimal");
    assert.equal(resolveQuickReplyConfig({ thinkLevel: "extra-high" }).thinkLevel, "minimal");
  });

  it("removes requiresConfirmation and validates values by UTF-8 bytes", () => {
    const decision = validateEvaluatorDecision({
      eligible: true,
      confidence: 1,
      suggestions: [{ label: "Approve", value: "Approve", requiresConfirmation: true }],
    }, DEFAULT_CONFIG);
    assert.deepEqual(decision?.suggestions, [{ label: "Approve", value: "Approve" }]);
    assert.equal(validateEvaluatorDecision({
      eligible: true,
      confidence: 1,
      suggestions: [{ label: "Emoji", value: "😀".repeat(11) }],
    }, DEFAULT_CONFIG), null);
  });
});
