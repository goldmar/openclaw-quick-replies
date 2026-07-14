import type {
  PluginHookReplyPayloadSendingContext,
  PluginHookReplyPayloadSendingEvent,
  PluginHookReplyPayloadSendingResult,
} from "openclaw/plugin-sdk/core";
import { buildUpdateCallbackData, QuickRepliesUpdateChecker } from "./update-checker";
import { hasExistingInteractivity } from "./interactivity";

export function createUpdateNoticeHook(checker: QuickRepliesUpdateChecker) {
  return (
    event: PluginHookReplyPayloadSendingEvent,
    ctx: PluginHookReplyPayloadSendingContext,
  ): PluginHookReplyPayloadSendingResult | void => {
    checker.maybeCheck();
    if ((event.channel ?? ctx.channelId) !== "telegram") return;
    if (typeof event.payload.text !== "string" || !event.payload.text.trim()) return;
    if (hasExistingInteractivity(event.payload)) return;

    const version = checker.claimPromptVersion();
    const callbackData = version ? buildUpdateCallbackData("install", version) : null;
    if (!version || !callbackData) return;

    const notice = `Quick Replies v${version} is available.`;
    return {
      payload: {
        ...event.payload,
        text: `${event.payload.text.trimEnd()}\n\n${notice}`,
        presentation: {
          ...event.payload.presentation,
          blocks: [
            ...(event.payload.presentation?.blocks ?? []),
            { type: "text", text: notice },
            {
              type: "buttons",
              buttons: [{
                label: `Update to v${version}`,
                action: { type: "callback", value: callbackData },
              }],
            },
          ],
        },
      },
    };
  };
}
