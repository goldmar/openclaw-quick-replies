import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  buildSuggestionCallbackData,
  CALLBACK_NAMESPACE,
  MAX_CALLBACK_VALUE_BYTES,
  parseSuggestionCallbackValue,
} from "../src/callbacks";
import { createTelegramInteractiveHandler, resetInteractiveHandlerStateForTests } from "../src/interactive-handler";

describe("strict Telegram callback values", () => {
  it("round-trips canonical oqr:v1 base64url values", () => {
    const payload = buildSuggestionCallbackData("Deploy to staging");
    assert.match(payload!, /^oqr:v1:[A-Za-z0-9_-]+$/u);
    assert.equal(parseSuggestionCallbackValue(payload), "Deploy to staging");
  });

  it("enforces the 42-byte submitted value limit", () => {
    assert.equal(MAX_CALLBACK_VALUE_BYTES, 42);
    assert.ok(buildSuggestionCallbackData("a".repeat(42)));
    assert.equal(buildSuggestionCallbackData("a".repeat(43)), null);
    assert.ok(buildSuggestionCallbackData("😀".repeat(10)));
    assert.equal(buildSuggestionCallbackData("😀".repeat(11)), null);
  });

  it("rejects malformed, oversized, and non-canonical callback data", () => {
    const valid = buildSuggestionCallbackData("Approve")!;
    const encoded = valid.slice("oqr:v1:".length);
    for (const payload of [
      null,
      "",
      "other:v1:QXBwcm92ZQ",
      "oqr:v2:QXBwcm92ZQ",
      `oqr:v1:${encoded}=`,
      "oqr:v1:+w",
      "oqr:v1:wA",
      `oqr:v1:${Buffer.from(" a", "utf8").toString("base64url")}`,
      `oqr:v1:${Buffer.from("a".repeat(43), "utf8").toString("base64url")}`,
    ]) {
      assert.equal(parseSuggestionCallbackValue(payload), null, String(payload));
    }
  });
});

describe("Telegram interaction routing", () => {
  beforeEach(() => resetInteractiveHandlerStateForTests());

  function context(overrides: Record<string, unknown> = {}) {
    const edits: Array<{ text: string; buttons: [] }> = [];
    let clears = 0;
    return {
      edits,
      get clears() { return clears; },
      value: {
        accountId: "default",
        conversationId: "chat-1",
        auth: { isAuthorizedSender: true },
        callback: {
          data: buildSuggestionCallbackData("Staging"),
          messageId: 42,
          messageText: "Where should I deploy?\n\n1. Staging\n2. Production",
        },
        respond: {
          editMessage: async (params: { text: string; buttons: [] }) => { edits.push(params); },
          clearButtons: async () => { clears += 1; },
        },
        ...overrides,
      },
    };
  }

  it("registers only the oqr Telegram namespace", () => {
    const registration = createTelegramInteractiveHandler();
    assert.equal(registration.channel, "telegram");
    assert.equal(registration.namespace, CALLBACK_NAMESPACE);
  });

  it("clears buttons in place, preserves source context, and deduplicates repeats", async () => {
    const registration = createTelegramInteractiveHandler();
    const fixture = context();
    const first = await registration.handler(fixture.value);
    assert.deepEqual(first, {
      handled: true,
      submitText: [
        "Quick reply selection for source message 42:",
        "",
        "Where should I deploy?\n\n1. Staging\n2. Production",
        "",
        "Selected:\nStaging",
      ].join("\n"),
    });
    assert.deepEqual(fixture.edits, [{
      text: "Where should I deploy?\n\n1. Staging\n2. Production\n\nSelected:\nStaging",
      buttons: [],
    }]);
    assert.deepEqual(await registration.handler(fixture.value), { handled: true });
    assert.equal(fixture.edits.length, 1);
  });

  it("rejects unauthorized callbacks without editing or submitting", async () => {
    const fixture = context({ auth: { isAuthorizedSender: false } });
    assert.deepEqual(await createTelegramInteractiveHandler().handler(fixture.value), { handled: true });
    assert.equal(fixture.edits.length, 0);
  });

  it("fails closed when source message context is unavailable", async () => {
    const fixture = context({
      callback: { data: buildSuggestionCallbackData("Staging"), messageId: 42 },
    });
    assert.deepEqual(await createTelegramInteractiveHandler().handler(fixture.value), { handled: true });
    assert.equal(fixture.edits.length, 0);
  });

  it("clears controls and still submits contextual text when editing fails", async (t) => {
    t.mock.method(console, "warn", () => {});
    const fixture = context({
      respond: {
        editMessage: async () => { throw new Error("edit failed"); },
        clearButtons: async () => {},
      },
    });
    const result = await createTelegramInteractiveHandler().handler(fixture.value);
    assert.equal(result && "submitText" in result, true);
  });
});
