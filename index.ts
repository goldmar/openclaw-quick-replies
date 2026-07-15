import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { resolveQuickReplyConfig } from "./src/config";
import { createQuickReplyPayloadHook } from "./src/decorator";
import { createTelegramInteractiveHandler } from "./src/interactive-handler";
import { QuickRepliesUpdateChecker } from "./src/update-checker";
import { createUpdateInteractiveHandler } from "./src/update-interactive-handler";
import { createUpdateNoticeHook } from "./src/update-notice";

function register(api: OpenClawPluginApi): void {
  const log = (event: string, fields: Record<string, unknown>) => {
    api.logger.info(`[openclaw-quick-replies] ${JSON.stringify({ event, ...fields })}`);
  };
  const updateChecker = new QuickRepliesUpdateChecker({
    currentVersion: api.version,
    enabled: () => resolveQuickReplyConfig(api.pluginConfig).updateChecks,
    log,
  });

  api.on("reply_payload_sending", createQuickReplyPayloadHook(api, { log }));
  api.on("reply_payload_sending", createUpdateNoticeHook(updateChecker));
  api.registerInteractiveHandler(createTelegramInteractiveHandler());
  api.registerInteractiveHandler(createUpdateInteractiveHandler(updateChecker));
  api.registerService(updateChecker.createService());
}

export default definePluginEntry({
  id: "openclaw-quick-replies",
  name: "OpenClaw Quick Replies",
  description: "Contextual one-tap reply suggestions for Telegram conversations",
  register,
});
