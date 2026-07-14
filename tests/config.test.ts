import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_CONFIG, resolveQuickReplyConfig, validateEvaluatorDecision } from "../src/config";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "..", "openclaw.plugin.json"), "utf8"));

describe("public configuration", () => {
  it("keeps runtime and manifest defaults aligned", () => {
    const properties = manifest.configSchema.properties;
    for (const key of [
      "enabled",
      "maxSuggestions",
      "minConfidence",
      "maxInputChars",
      "maxLabelChars",
      "maxValueBytes",
      "evaluationTimeoutMs",
    ] as const) {
      assert.equal(properties[key].default, DEFAULT_CONFIG[key]);
    }
    assert.equal(properties.maxSuggestions.type, "integer");
    assert.equal(properties.maxInputChars.type, "integer");
    assert.equal(properties.maxLabelChars.type, "integer");
    assert.equal(properties.maxValueBytes.type, "integer");
    assert.equal(properties.evaluationTimeoutMs.type, "integer");
    assert.equal(DEFAULT_CONFIG.evaluationTimeoutMs, 20_000);
  });

  it("clamps integers and normalizes the model override", () => {
    assert.deepEqual(resolveQuickReplyConfig({
      enabled: false,
      maxSuggestions: 99,
      minConfidence: -1,
      model: "  openai/example  ",
      maxInputChars: 99_999,
      maxLabelChars: 99,
      maxValueBytes: 99,
      evaluationTimeoutMs: 99_999,
    }), {
      enabled: false,
      maxSuggestions: 10,
      minConfidence: 0,
      model: "openai/example",
      maxInputChars: 12_000,
      maxLabelChars: 64,
      maxValueBytes: 42,
      evaluationTimeoutMs: 30_000,
    });
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
