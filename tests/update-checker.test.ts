import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  PluginHookReplyPayloadSendingContext,
  PluginHookReplyPayloadSendingEvent,
} from "openclaw/plugin-sdk/core";
import {
  buildUpdateCallbackData,
  isNewerStableVersion,
  parseUpdateCallbackData,
  QuickRepliesUpdateChecker,
  setUpdateCheckerStateDirForTests,
  UPDATE_APPROVAL_TTL_MS,
  UPDATE_CALLBACK_NAMESPACE,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_RESTART_APPROVAL_TTL_MS,
} from "../src/update-checker";
import { createUpdateInteractiveHandler } from "../src/update-interactive-handler";
import { createUpdateNoticeHook } from "../src/update-notice";

function stateDir(): string {
  return mkdtempSync(join(tmpdir(), "quick-replies-update-"));
}

function event(text: string, channel = "telegram"): PluginHookReplyPayloadSendingEvent {
  return { kind: "final", channel, payload: { text } } as PluginHookReplyPayloadSendingEvent;
}

function inspection(source: "npm" | "clawhub" = "npm"): string {
  return JSON.stringify({ install: { source } });
}

const context = { channelId: "telegram", messageId: "message-1" } as PluginHookReplyPayloadSendingContext;

describe("Quick Replies update checker", () => {
  it("accepts only canonical stable-version callback payloads", () => {
    assert.deepEqual(parseUpdateCallbackData(buildUpdateCallbackData("install", "0.1.2")), {
      action: "install",
      version: "0.1.2",
    });
    assert.equal(parseUpdateCallbackData("oqru:v1:install:latest"), null);
    assert.equal(parseUpdateCallbackData("oqru:v1:install:0.1.2-beta.1"), null);
    assert.equal(parseUpdateCallbackData("oqru:v1:install:00.1.2"), null);
    assert.equal(parseUpdateCallbackData("oqru:v1:install:9007199254740992.1.2"), null);
    assert.equal(parseUpdateCallbackData("oqru:v2:install:0.1.2"), null);
    assert.equal(isNewerStableVersion("0.1.2", "0.1.1"), true);
    assert.equal(isNewerStableVersion("0.1.1", "0.1.1"), false);
  });

  it("checks without blocking replies and polls at most once per day", async () => {
    let now = Date.parse("2026-07-13T12:00:00.000Z");
    let fetches = 0;
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      now: () => now,
      fetchLatestVersion: async () => { fetches += 1; return "0.1.2"; },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    checker.maybeCheck();
    await checker.waitForIdle();
    assert.equal(fetches, 1);

    now += UPDATE_CHECK_INTERVAL_MS + 1;
    checker.maybeCheck();
    await checker.waitForIdle();
    assert.equal(fetches, 2);
  });

  it("does no network or install work when update checks are disabled", async () => {
    let fetches = 0;
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => false,
      fetchLatestVersion: async () => { fetches += 1; return "0.1.2"; },
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { stdout: args[1] === "inspect" ? inspection() : "", stderr: "" };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();

    assert.equal(fetches, 0);
    assert.equal(checker.claimPromptVersion(), undefined);
    assert.equal(checker.canInstall("0.1.2"), false);
    assert.deepEqual(commands, []);
  });

  it("offers updates only on otherwise non-interactive Telegram messages", async () => {
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    const hook = createUpdateNoticeHook(checker);

    assert.equal(hook(event("Status", "discord"), { ...context, channelId: "discord" }), undefined);
    const channelInteractive = event("Choose one");
    channelInteractive.payload.channelData = {
      telegram: { reply_markup: { inline_keyboard: [[{ text: "Existing", callback_data: "existing" }]] } },
    };
    assert.equal(hook(channelInteractive, context), undefined);

    const result = hook(event("Deployment completed."), context);
    assert.match(result?.payload?.text ?? "", /Quick Replies v0\.1\.2 is available/);
    const buttonBlock = result?.payload?.presentation?.blocks.find((block) => block.type === "buttons");
    assert.equal(buttonBlock?.type, "buttons");
    const action = buttonBlock?.type === "buttons" ? buttonBlock.buttons[0]?.action : undefined;
    assert.equal(action?.type === "callback" ? action.value : undefined, "oqru:v1:install:0.1.2");

    const interactive = event("Choose one");
    interactive.payload.presentation = { blocks: [{ type: "buttons", buttons: [{ label: "Existing", value: "existing" }] }] };
    assert.equal(hook(interactive, context), undefined);
  });

  it("installs the exact approved version even after the registry tag moves", async () => {
    const commands: string[][] = [];
    const edits: Array<{ text: string; buttons: Array<Array<{ text: string; callback_data: string }>> }> = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { stdout: args[1] === "inspect" ? inspection() : "", stderr: "" };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    const registration = createUpdateInteractiveHandler(checker);
    assert.equal(registration.namespace, UPDATE_CALLBACK_NAMESPACE);
    const rawContext = {
      auth: { isAuthorizedSender: true },
      callback: { data: "oqru:v1:install:0.1.2", messageText: "Update available" },
      respond: { editMessage: async (params: typeof edits[number]) => { edits.push(params); } },
    };
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.deepEqual(commands, [
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
      ["openclaw", "plugins", "update", "openclaw-quick-replies@0.1.2"],
    ]);
    assert.match(edits[0]?.text ?? "", /v0\.1\.2 was installed/);
    assert.equal(edits[0]?.buttons[0]?.[0]?.callback_data, "oqru:v1:restart:0.1.2");

    rawContext.callback.data = "oqru:v1:restart:0.1.2";
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.deepEqual(commands.at(-1), ["openclaw", "gateway", "restart"]);
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.equal(commands.length, 3);
  });

  it("rejects unauthorized, unprompted, and repeated install callbacks", async () => {
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { stdout: args[1] === "inspect" ? inspection() : "", stderr: "" };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    const registration = createUpdateInteractiveHandler(checker);
    const base = {
      callback: { data: "oqru:v1:install:0.1.2", messageText: "Update available" },
      respond: { editMessage: async () => {} },
    };

    await registration.handler({ ...base, auth: { isAuthorizedSender: false } });
    await registration.handler({ ...base, auth: { isAuthorizedSender: true } });
    assert.deepEqual(commands, []);

    assert.equal(checker.claimPromptVersion(), "0.1.2");
    await registration.handler({ ...base, auth: { isAuthorizedSender: true } });
    await registration.handler({ ...base, auth: { isAuthorizedSender: true } });
    assert.deepEqual(commands, [
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
      ["openclaw", "plugins", "update", "openclaw-quick-replies@0.1.2"],
    ]);
  });

  it("rejects an expired update approval", async () => {
    let now = Date.parse("2026-07-13T12:00:00.000Z");
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      now: () => now,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { stdout: args[1] === "inspect" ? inspection() : "", stderr: "" };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    now += UPDATE_APPROVAL_TTL_MS + 1;
    await assert.rejects(checker.install("0.1.2"), /expired/);
    assert.deepEqual(commands, []);
  });

  it("expires restart approval independently of update approval", async () => {
    let now = Date.parse("2026-07-13T12:00:00.000Z");
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      now: () => now,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { stdout: args[1] === "inspect" ? inspection() : "", stderr: "" };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");
    await checker.install("0.1.2");

    now += UPDATE_RESTART_APPROVAL_TTL_MS + 1;
    assert.equal(checker.canRestart("0.1.2"), false);
    await assert.rejects(checker.restart("0.1.2"), /expired/);
    assert.equal(commands.length, 2);
  });

  it("does not let Telegram edit failures misreport installs or block confirmed restarts", async () => {
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { stdout: args[1] === "inspect" ? inspection() : "", stderr: "" };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    const registration = createUpdateInteractiveHandler(checker);
    const rawContext = {
      auth: { isAuthorizedSender: true },
      callback: { data: "oqru:v1:install:0.1.2", messageText: "Update available" },
      respond: { editMessage: async () => { throw new Error("message is no longer editable"); } },
    };
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.deepEqual(commands, [
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
      ["openclaw", "plugins", "update", "openclaw-quick-replies@0.1.2"],
    ]);

    rawContext.callback.data = "oqru:v1:restart:0.1.2";
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.deepEqual(commands.at(-1), ["openclaw", "gateway", "restart"]);
  });

  it("uses the documented exact ClawHub reinstall path for ClawHub-managed installs", async () => {
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { stdout: args[1] === "inspect" ? inspection("clawhub") : "", stderr: "" };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    await checker.install("0.1.2");

    assert.deepEqual(commands, [
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
      ["openclaw", "plugins", "install", "clawhub:openclaw-quick-replies@0.1.2", "--force"],
    ]);
  });
});
