import type { PluginInteractiveRegistration } from "openclaw/plugin-sdk/plugin-runtime";
import { isRecord } from "./config";
import {
  buildUpdateCallbackData,
  parseUpdateCallbackData,
  QuickRepliesUpdateChecker,
  UPDATE_CALLBACK_NAMESPACE,
} from "./update-checker";

type UpdateInteractionResult = { handled?: boolean } | void;
type TelegramButton = { text: string; callback_data: string };

export function createUpdateInteractiveHandler(
  checker: QuickRepliesUpdateChecker,
): PluginInteractiveRegistration<unknown, "telegram", UpdateInteractionResult> {
  return {
    channel: "telegram",
    namespace: UPDATE_CALLBACK_NAMESPACE,
    handler: (rawContext) => handleUpdateCallback(rawContext, checker),
  };
}

async function handleUpdateCallback(raw: unknown, checker: QuickRepliesUpdateChecker): Promise<UpdateInteractionResult> {
  const ctx = parseContext(raw);
  if (!ctx) {
    checker.logCallback("update_callback_rejected", { reason: "invalid_context" });
    return { handled: false };
  }
  const callback = parseUpdateCallbackData(ctx.data);
  if (!callback) {
    checker.logCallback("update_callback_rejected", { reason: "invalid_payload" });
    return { handled: false };
  }
  checker.logCallback("update_callback_received", { action: callback.action, version: callback.version });
  if (!ctx.authorized) {
    checker.logCallback("update_callback_rejected", { action: callback.action, version: callback.version, reason: "unauthorized" });
    return { handled: true };
  }

  if (callback.action === "install") {
    if (!checker.canInstall(callback.version)) {
      checker.logCallback("update_callback_rejected", { action: callback.action, version: callback.version, reason: "not_approved" });
      return { handled: true };
    }
    try {
      await checker.install(callback.version);
    } catch (error) {
      await safeEdit(ctx, `${ctx.messageText.trimEnd()}\n\nThe Quick Replies update failed or could not be verified. Check the Gateway logs and try again.`, checker, callback);
      return { handled: true };
    }
    const restartData = buildUpdateCallbackData("restart", callback.version)!;
    await safeEdit(ctx, `${ctx.messageText.trimEnd()}\n\nQuick Replies v${callback.version} was installed and verified. Restart the Gateway to load it.`, checker, callback, [[
      { text: "Restart Gateway", callback_data: restartData },
    ]]);
    return { handled: true };
  }

  if (!checker.canRestart(callback.version)) {
    checker.logCallback("update_callback_rejected", { action: callback.action, version: callback.version, reason: "not_approved" });
    return { handled: true };
  }
  checker.logCallback("gateway_restart_approved", { version: callback.version });
  await safeEdit(ctx, `${ctx.messageText.trimEnd()}\n\nRestarting the Gateway to load Quick Replies v${callback.version}…`, checker, callback);
  try {
    await checker.restart(callback.version);
  } catch (error) {
    checker.logCallback("gateway_restart_failed", { version: callback.version, error: error instanceof Error ? error.message : String(error) });
    await safeEdit(ctx, `${ctx.messageText.trimEnd()}\n\nThe Gateway restart failed. Run: openclaw gateway restart`, checker, callback);
  }
  return { handled: true };
}

function parseContext(raw: unknown): {
  authorized: boolean;
  data: unknown;
  editMessage: (params: { text: string; buttons: TelegramButton[][] }) => Promise<void>;
  messageText: string;
} | null {
  if (!isRecord(raw) || !isRecord(raw.callback) || !isRecord(raw.auth) || !isRecord(raw.respond)) return null;
  if (typeof raw.respond.editMessage !== "function") return null;
  return {
    authorized: raw.auth.isAuthorizedSender === true,
    data: raw.callback.data,
    editMessage: raw.respond.editMessage as (params: { text: string; buttons: TelegramButton[][] }) => Promise<void>,
    messageText: typeof raw.callback.messageText === "string" ? raw.callback.messageText.trim() : "Quick Replies update",
  };
}

async function safeEdit(
  ctx: { editMessage: (params: { text: string; buttons: TelegramButton[][] }) => Promise<void> },
  text: string,
  checker: QuickRepliesUpdateChecker,
  callback: { action: "install" | "restart"; version: string },
  buttons: TelegramButton[][] = [],
): Promise<void> {
  try {
    await ctx.editMessage({ text, buttons });
  } catch (error) {
    checker.logCallback("update_callback_edit_failed", {
      action: callback.action,
      version: callback.version,
      error: error instanceof Error ? error.message : String(error),
    });
    // The command result is authoritative even if Telegram can no longer edit the source message.
  }
}
