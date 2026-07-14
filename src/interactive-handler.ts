import type { PluginInteractiveRegistration } from "openclaw/plugin-sdk/plugin-runtime";
import { CALLBACK_NAMESPACE, parseSuggestionCallbackValue } from "./callbacks";
import { isRecord } from "./config";

type TelegramQuickReplyResult = { handled?: boolean; submitText?: string } | void;

const SELECTION_TTL_MS = 5 * 60_000;
const MAX_RECENT_SELECTIONS = 1_000;
const recentSelections = new Map<string, number>();

export function createTelegramInteractiveHandler(): PluginInteractiveRegistration<unknown, "telegram", TelegramQuickReplyResult> {
  return {
    channel: "telegram",
    namespace: CALLBACK_NAMESPACE,
    handler: handleTelegramCallback,
  };
}

async function handleTelegramCallback(rawContext: unknown): Promise<TelegramQuickReplyResult> {
  const ctx = parseContext(rawContext);
  if (!ctx) return { handled: false };
  const value = parseSuggestionCallbackValue(ctx.data);
  if (!value) return { handled: false };
  if (!ctx.authorized) return { handled: true };
  if (!ctx.messageText || !Number.isSafeInteger(ctx.messageId)) return { handled: true };

  const selectionKey = `${ctx.accountId}:${ctx.conversationId}:${ctx.messageId}`;
  if (hasRecentSelection(selectionKey)) return { handled: true };
  recordSelection(selectionKey);

  const selectedText = appendSelection(ctx.messageText, value);
  try {
    await ctx.editMessage({ text: selectedText, buttons: [] });
  } catch (error) {
    logWarning("Failed to edit the selected Telegram quick reply", error);
    try {
      await ctx.clearButtons();
    } catch (clearError) {
      logWarning("Failed to clear Telegram quick reply buttons", clearError);
    }
  }

  return {
    handled: true,
    submitText: [
      `Quick reply selection for source message ${ctx.messageId}:`,
      "",
      ctx.messageText,
      "",
      `Selected:\n${value}`,
    ].join("\n"),
  };
}

function parseContext(raw: unknown): {
  accountId: string;
  authorized: boolean;
  clearButtons: () => Promise<void>;
  conversationId: string;
  data: unknown;
  editMessage: (params: { text: string; buttons: [] }) => Promise<void>;
  messageId: number;
  messageText: string;
} | null {
  if (!isRecord(raw) || !isRecord(raw.callback) || !isRecord(raw.auth) || !isRecord(raw.respond)) return null;
  const editMessage = raw.respond.editMessage;
  const clearButtons = raw.respond.clearButtons;
  if (typeof editMessage !== "function" || typeof clearButtons !== "function") return null;
  return {
    accountId: typeof raw.accountId === "string" ? raw.accountId : "",
    authorized: raw.auth.isAuthorizedSender === true,
    clearButtons: clearButtons as () => Promise<void>,
    conversationId: typeof raw.conversationId === "string" ? raw.conversationId : "",
    data: raw.callback.data,
    editMessage: editMessage as (params: { text: string; buttons: [] }) => Promise<void>,
    messageId: typeof raw.callback.messageId === "number" ? raw.callback.messageId : Number.NaN,
    messageText: typeof raw.callback.messageText === "string" ? raw.callback.messageText.trim() : "",
  };
}

function appendSelection(sourceText: string, value: string): string {
  return `${normalizeQuickRepliesVisibleSpacing(sourceText).trimEnd()}\n\nSelected:\n${value}`;
}

function normalizeQuickRepliesVisibleSpacing(value: string): string {
  return value.replace(
    /(^|\n)(Quick replies:)[ \t]*\n(?:[ \t]*\n)+(?=[ \t]*(?:\d{1,2}[.)]|[-*])\s+\S)/giu,
    "$1$2\n",
  );
}

function hasRecentSelection(key: string): boolean {
  pruneSelections();
  const expiresAt = recentSelections.get(key);
  return typeof expiresAt === "number" && expiresAt > Date.now();
}

function recordSelection(key: string): void {
  pruneSelections();
  recentSelections.set(key, Date.now() + SELECTION_TTL_MS);
  while (recentSelections.size > MAX_RECENT_SELECTIONS) {
    const oldest = recentSelections.keys().next();
    if (oldest.done) break;
    recentSelections.delete(oldest.value);
  }
}

function pruneSelections(): void {
  const now = Date.now();
  for (const [key, expiresAt] of recentSelections) {
    if (expiresAt <= now) recentSelections.delete(key);
  }
}

function logWarning(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[openclaw-quick-replies] ${message}: ${detail}`);
}

export function resetInteractiveHandlerStateForTests(): void {
  recentSelections.clear();
}
