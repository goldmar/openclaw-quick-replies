import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { createQuickReplyPayloadHook } from "./src/decorator";
import { createTelegramInteractiveHandler } from "./src/interactive-handler";

function register(api: OpenClawPluginApi): void {
  const log = (event: string, fields: Record<string, unknown>) => {
    api.logger.info(`[openclaw-quick-replies] ${JSON.stringify({ event, ...fields })}`);
  };

  api.on("reply_payload_sending", createQuickReplyPayloadHook(api, { log }));
  api.registerInteractiveHandler(createTelegramInteractiveHandler());
}

export default definePluginEntry({
  id: "openclaw-quick-replies",
  name: "Quick Replies",
  description: "Contextual one-tap reply suggestions for Telegram conversations",
  register,
});
