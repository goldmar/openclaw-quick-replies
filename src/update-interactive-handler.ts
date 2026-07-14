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
  if (!ctx) return { handled: false };
  const callback = parseUpdateCallbackData(ctx.data);
  if (!callback) return { handled: false };
  if (!ctx.authorized) return { handled: true };

  if (callback.action === "install") {
    if (!checker.canInstall(callback.version)) return { handled: true };
    try {
      await checker.install(callback.version);
    } catch (error) {
      await safeEdit(ctx, `${ctx.messageText.trimEnd()}\n\nThe Quick Replies update failed. Check the Gateway logs and try again.`);
      return { handled: true };
    }
    const restartData = buildUpdateCallbackData("restart", callback.version)!;
    await safeEdit(ctx, `${ctx.messageText.trimEnd()}\n\nQuick Replies v${callback.version} was installed. Restart the Gateway to load it.`, [[
      { text: "Restart Gateway", callback_data: restartData },
    ]]);
    return { handled: true };
  }

  if (!checker.canRestart(callback.version)) return { handled: true };
  await safeEdit(ctx, `${ctx.messageText.trimEnd()}\n\nRestarting the Gateway to load Quick Replies v${callback.version}…`);
  try {
    await checker.restart(callback.version);
  } catch (error) {
    await safeEdit(ctx, `${ctx.messageText.trimEnd()}\n\nThe Gateway restart failed. Run: openclaw gateway restart`);
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
  buttons: TelegramButton[][] = [],
): Promise<void> {
  try {
    await ctx.editMessage({ text, buttons });
  } catch {
    // The command result is authoritative even if Telegram can no longer edit the source message.
  }
}
