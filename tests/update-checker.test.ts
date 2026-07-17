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

function inspection(source: "npm" | "clawhub" = "npm", version = "0.1.1"): string {
  return JSON.stringify({ plugin: { version }, install: { source, version } });
}

function inspectionWithoutInstallVersion(source: "npm" | "clawhub", pluginVersion: string): string {
  return JSON.stringify({ plugin: { version: pluginVersion }, install: { source } });
}

function managedRunner(
  commands: string[][],
  source: "npm" | "clawhub" = "npm",
  installedVersion = "0.1.2",
) {
  let installed = false;
  return async (command: string, args: string[]) => {
    commands.push([command, ...args]);
    if (args[1] === "install") installed = true;
    return { stdout: args[1] === "inspect" ? inspection(source, installed ? installedVersion : "0.1.1") : "", stderr: "" };
  };
}

const context = { channelId: "telegram", messageId: "message-1" } as PluginHookReplyPayloadSendingContext;

describe("OpenClaw Quick Replies update checker", () => {
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
      runCommand: managedRunner(commands),
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
    assert.match(result?.payload?.text ?? "", /OpenClaw Quick Replies v0\.1\.2 is available/);
    const buttonBlock = result?.payload?.presentation?.blocks.find((block) => block.type === "buttons");
    assert.equal(buttonBlock?.type, "buttons");
    const action = buttonBlock?.type === "buttons" ? buttonBlock.buttons[0]?.action : undefined;
    assert.equal(action?.type === "callback" ? action.value : undefined, "oqru:v1:install:0.1.2");

    const interactive = event("Choose one");
    interactive.payload.presentation = { blocks: [{ type: "buttons", buttons: [{ label: "Existing", value: "existing" }] }] };
    assert.equal(hook(interactive, context), undefined);
  });

  it("installs and restarts in edit-only contexts even after the registry tag moves", async () => {
    const commands: string[][] = [];
    const edits: Array<{ text: string; buttons: Array<Array<{ text: string; callback_data: string }>> }> = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: managedRunner(commands),
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    const registration = createUpdateInteractiveHandler(checker);
    assert.equal(registration.namespace, UPDATE_CALLBACK_NAMESPACE);
    const rawContext = {
      auth: { isAuthorizedSender: true },
      callback: { data: "oqru:v1:install:0.1.2", messageText: "Update available" },
      respond: {
        editMessage: async (params: typeof edits[number]) => { edits.push(params); },
      },
    };
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.deepEqual(commands, [
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
      ["openclaw", "plugins", "install", "openclaw-quick-replies@0.1.2", "--force"],
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
    ]);
    assert.match(edits[0]?.text ?? "", /OpenClaw Quick Replies v0\.1\.2 was installed/);
    assert.equal(edits[0]?.buttons[0]?.[0]?.callback_data, "oqru:v1:restart:0.1.2");

    rawContext.callback.data = "oqru:v1:restart:0.1.2";
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.match(edits[1]?.text ?? "", /load OpenClaw Quick Replies v0\.1\.2/);
    assert.deepEqual(commands.at(-1), ["openclaw", "gateway", "restart"]);
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.equal(commands.length, 4);
  });

  it("rejects unauthorized, unprompted, and repeated install callbacks", async () => {
    const commands: string[][] = [];
    const responses: string[] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: managedRunner(commands),
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    const registration = createUpdateInteractiveHandler(checker);
    const base = {
      callback: { data: "oqru:v1:install:0.1.2", messageText: "Update available" },
      respond: {
        editMessage: async ({ text }: { text: string }) => { responses.push(text); },
        reply: async ({ text }: { text: string }) => { responses.push(text); },
      },
    };

    await registration.handler({ ...base, auth: { isAuthorizedSender: false } });
    assert.deepEqual(responses, []);
    await registration.handler({ ...base, auth: { isAuthorizedSender: true } });
    assert.deepEqual(commands, []);
    assert.match(responses[0] ?? "", /update approval is no longer valid/i);

    assert.equal(checker.claimPromptVersion(), "0.1.2");
    await registration.handler({ ...base, auth: { isAuthorizedSender: true } });
    await registration.handler({ ...base, auth: { isAuthorizedSender: true } });
    assert.deepEqual(commands, [
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
      ["openclaw", "plugins", "install", "openclaw-quick-replies@0.1.2", "--force"],
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
    ]);
    assert.match(responses.at(-1) ?? "", /update approval is no longer valid/i);
  });

  it("explains a stale update callback through the reply fallback", async () => {
    const commands: string[][] = [];
    const replies: Array<{ text: string; buttons: unknown[] }> = [];
    const staleChecker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      runCommand: managedRunner(commands),
    });

    const result = await createUpdateInteractiveHandler(staleChecker).handler({
      auth: { isAuthorizedSender: true },
      callback: { data: "oqru:v1:install:0.1.2", messageText: "Update available" },
      respond: {
        editMessage: async () => { throw new Error("stale handler cannot edit"); },
        reply: async (params: typeof replies[number]) => { replies.push(params); },
      },
    });

    assert.deepEqual(result, { handled: true });
    assert.match(replies[0]?.text ?? "", /update approval is no longer valid/i);
    assert.deepEqual(replies[0]?.buttons, []);
    assert.deepEqual(commands, []);
  });

  it("rejects an expired update approval", async () => {
    let now = Date.parse("2026-07-13T12:00:00.000Z");
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      now: () => now,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: managedRunner(commands),
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
      runCommand: managedRunner(commands),
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");
    await checker.install("0.1.2");

    now += UPDATE_RESTART_APPROVAL_TTL_MS + 1;
    assert.equal(checker.canRestart("0.1.2"), false);
    await assert.rejects(checker.restart("0.1.2"), /expired/);
    assert.equal(commands.length, 3);

    const edits: Array<{ text: string; buttons: unknown[] }> = [];
    const result = await createUpdateInteractiveHandler(checker).handler({
      auth: { isAuthorizedSender: true },
      callback: { data: "oqru:v1:restart:0.1.2", messageText: "Update installed" },
      respond: { editMessage: async (params: typeof edits[number]) => { edits.push(params); } },
    });
    assert.deepEqual(result, { handled: true });
    assert.match(edits[0]?.text ?? "", /restart approval is no longer valid/i);
    assert.deepEqual(edits[0]?.buttons, []);
    assert.equal(commands.length, 3);
  });

  it("falls back to a normal message when the post-install success edit fails", async () => {
    const commands: string[][] = [];
    const replies: Array<{ text: string; buttons: Array<Array<{ text: string; callback_data: string }>> }> = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: managedRunner(commands),
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    const registration = createUpdateInteractiveHandler(checker);
    const rawContext = {
      auth: { isAuthorizedSender: true },
      callback: { data: "oqru:v1:install:0.1.2", messageText: "Update available" },
      respond: {
        editMessage: async () => { throw new Error("message is no longer editable"); },
        reply: async (params: typeof replies[number]) => { replies.push(params); },
      },
    };
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.deepEqual(commands, [
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
      ["openclaw", "plugins", "install", "openclaw-quick-replies@0.1.2", "--force"],
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
    ]);
    assert.match(replies[0]?.text ?? "", /v0\.1\.2 was installed and verified/);
    assert.equal(replies[0]?.buttons[0]?.[0]?.callback_data, "oqru:v1:restart:0.1.2");

    rawContext.callback.data = "oqru:v1:restart:0.1.2";
    assert.deepEqual(await registration.handler(rawContext), { handled: true });
    assert.deepEqual(commands.at(-1), ["openclaw", "gateway", "restart"]);
  });

  it("falls back to a normal message when the post-install error edit fails", async () => {
    const commands: string[][] = [];
    const replies: Array<{ text: string; buttons: Array<Array<{ text: string; callback_data: string }>> }> = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        if (args[1] === "install") throw new Error("install failed");
        return { stdout: inspection(), stderr: "" };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    const result = await createUpdateInteractiveHandler(checker).handler({
      auth: { isAuthorizedSender: true },
      callback: { data: "oqru:v1:install:0.1.2", messageText: "Update available" },
      respond: {
        editMessage: async () => { throw new Error("message is no longer editable"); },
        reply: async (params: typeof replies[number]) => { replies.push(params); },
      },
    });

    assert.deepEqual(result, { handled: true });
    assert.match(replies[0]?.text ?? "", /update failed or could not be verified/);
    assert.deepEqual(replies[0]?.buttons, []);
    assert.equal(checker.canRestart("0.1.2"), false);
    assert.deepEqual(commands, [
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
      ["openclaw", "plugins", "install", "openclaw-quick-replies@0.1.2", "--force"],
    ]);
  });

  it("uses the documented exact ClawHub reinstall path for ClawHub-managed installs", async () => {
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: managedRunner(commands, "clawhub"),
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    await checker.install("0.1.2");

    assert.deepEqual(commands, [
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
      ["openclaw", "plugins", "install", "clawhub:openclaw-quick-replies@0.1.2", "--force"],
      ["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"],
    ]);
  });

  it("rejects an exit-zero install that did not install the approved version", async () => {
    const commands: string[][] = [];
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: managedRunner(commands, "npm", "0.1.1"),
      log: (event, fields) => events.push({ event, fields }),
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    await assert.rejects(checker.install("0.1.2"), /requested, but manifest v0\.1\.1 is installed/);
    assert.equal(checker.canRestart("0.1.2"), false);
    assert.ok(events.some(({ event }) => event === "update_install_failed"));
  });

  it("updates when plain inspection omits the optional install-record version", async () => {
    const commands: string[][] = [];
    let installed = false;
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        if (args[1] === "install") installed = true;
        return {
          stdout: args[1] === "inspect"
            ? inspectionWithoutInstallVersion("npm", installed ? "0.1.2" : "0.1.1")
            : "",
          stderr: "",
        };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    await checker.install("0.1.2");
    assert.equal(checker.canRestart("0.1.2"), true);
    assert.deepEqual(commands[1], ["openclaw", "plugins", "install", "openclaw-quick-replies@0.1.2", "--force"]);
  });

  it("rejects a present malformed install-record version", async () => {
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return {
          stdout: args[1] === "inspect"
            ? JSON.stringify({ plugin: { version: "0.1.1" }, install: { source: "npm", version: "latest" } })
            : "",
          stderr: "",
        };
      },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    await assert.rejects(checker.install("0.1.2"), /source cannot be verified/);
    assert.deepEqual(commands, [["openclaw", "plugins", "inspect", "openclaw-quick-replies", "--json"]]);
    assert.equal(checker.canRestart("0.1.2"), false);
  });

  it("keeps valid callbacks and installs working when diagnostic logging throws", async () => {
    const commands: string[][] = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      fetchLatestVersion: async () => "0.1.2",
      runCommand: managedRunner(commands),
      log: () => { throw new Error("logger unavailable"); },
    });
    setUpdateCheckerStateDirForTests(checker, stateDir());
    await checker.waitForIdle();
    assert.equal(checker.claimPromptVersion(), "0.1.2");

    const result = await createUpdateInteractiveHandler(checker).handler({
      auth: { isAuthorizedSender: true },
      callback: { data: "oqru:v1:install:0.1.2", messageText: "Update available" },
      respond: { editMessage: async () => {}, reply: async () => {} },
    });
    assert.deepEqual(result, { handled: true });
    assert.equal(checker.canRestart("0.1.2"), true);
  });

  it("logs callback rejection reasons without callback or message contents", async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const checker = new QuickRepliesUpdateChecker({
      currentVersion: "0.1.1",
      enabled: () => true,
      log: (event, fields) => events.push({ event, fields }),
    });
    const registration = createUpdateInteractiveHandler(checker);
    await registration.handler({
      auth: { isAuthorizedSender: false },
      callback: { data: "oqru:v1:install:0.1.2", messageText: "private text" },
      respond: { editMessage: async () => {}, reply: async () => {} },
    });
    assert.deepEqual(events.at(-1), {
      event: "update_callback_rejected",
      fields: { action: "install", version: "0.1.2", reason: "unauthorized" },
    });
    assert.doesNotMatch(JSON.stringify(events), /private text|oqru:v1/);
  });
});
