# Architecture

Quick Replies is a Telegram-only OpenClaw hook plugin with a small update-check service.

The `reply_payload_sending` hook rejects unsupported channels, non-plain payloads, existing controls, long input, and messages without an explicit ask. Eligible text is evaluated through `api.runtime.agent.runEmbeddedAgent` as a raw `modelRun` with tools and delivery disabled. The run receives an immutable config projection without OpenClaw user MCP servers; the shared OpenClaw config is never changed. The validated decision becomes portable `presentation.blocks` callback buttons.

Evaluation has a configurable timeout, cancellation of timed-out embedded runs, concurrent promise deduplication, and a bounded five-minute semantic result cache. Message identifiers are not part of the cache key, so the same text and evaluator settings can reuse a validated eligible or ineligible decision. Failures and timeouts are never cached and are retried by later messages. Timeout or any evaluator failure leaves the outgoing payload unchanged.

Structured diagnostics divide plugin filtering/cache time, embedded-run time, validation, temporary-directory cleanup, and total synchronous hook time. They intentionally contain no prompt or model-output text. Telegram delivery begins only after `reply_payload_sending` returns, so transport latency is downstream and is not included in the plugin's `totalMs`.

## OpenClaw 2026.7.1 Codex MCP limitation

OpenClaw 2026.7.1 does not expose a plugin-run option that explicitly clears Codex's own user-level `mcp_servers` at `thread/start`. With tools disabled, the Codex harness omits OpenClaw's projected MCP configuration, but omission allows the managed app-server to inherit MCP entries from `~/.codex/config.toml`. A fresh temporary evaluator thread can therefore start those servers even though the model cannot call tools. Removing the plugin's temporary session directory does not archive the native Codex thread or release its inherited MCP children.

The core fix should make raw model runs/tool-disabled threads explicitly override inherited `mcp_servers` with an empty set and archive one-shot native threads after unsubscribe without retiring the shared app-server. Core regression coverage should assert that a `modelRun` with disabled tools starts no configured user MCP process, archives its transient thread on success/error/timeout, and leaves unrelated shared-client threads running. The plugin cannot safely implement those lifecycle operations through the 2026.7.1 API, so it does not mutate global Codex configuration, retire the shared app-server, or kill processes.

Telegram dispatches the `oqr` namespace to the plugin's interactive handler. The handler validates the canonical versioned payload, authorization, source message ID, and source message text. It edits the source message with `Selected:\n<value>` and empty buttons, then returns source-bound `submitText`. The first valid selection for a source message wins for five minutes.

The update checker requests public npm package metadata at most once per day and persists only version/timestamp state under OpenClaw's plugin state directory. A second outbound hook offers an update only on Telegram payloads without existing controls. The `oqru` handler accepts canonical stable versions from a recent plugin-issued prompt, inspects the managed install source, and invokes OpenClaw without a shell: npm installs use `plugins update <package>@<exact-version>`, while ClawHub installs use the documented `plugins install clawhub:<package>@<exact-version> --force` path. A separate callback is required before invoking `openclaw gateway restart`.

Discord is intentionally absent. Its public interaction result has no generic `submitText` equivalent, so rendering buttons there would create controls that cannot safely continue an arbitrary agent conversation.
