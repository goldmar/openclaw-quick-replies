import type { PluginHookReplyPayload } from "openclaw/plugin-sdk/core";
import { isRecord } from "./config";

export function hasExistingInteractivity(payload: PluginHookReplyPayload): boolean {
  if (payload.btw || payload.interactive?.blocks.length) return true;
  if (payload.presentation?.blocks.some((block) => block.type === "buttons" || block.type === "select")) return true;
  return hasControlLikeChannelData(payload.channelData);
}

function hasControlLikeChannelData(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const stack: unknown[] = [raw];
  while (stack.length > 0) {
    const next = stack.pop();
    if (Array.isArray(next)) {
      stack.push(...next);
      continue;
    }
    if (!isRecord(next)) continue;
    for (const [key, value] of Object.entries(next)) {
      if (["buttons", "reply_markup", "inline_keyboard", "components"].includes(key) && value) return true;
      if (isRecord(value) || Array.isArray(value)) stack.push(value);
    }
  }
  return false;
}
