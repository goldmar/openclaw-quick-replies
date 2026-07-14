# Architecture

Quick Replies is a Telegram-only OpenClaw hook plugin with a small update-check service.

The `reply_payload_sending` hook rejects unsupported channels, non-plain payloads, existing controls, long input, and messages without an explicit ask. Eligible text is evaluated through `api.runtime.agent.runEmbeddedAgent` with tools and delivery disabled. The validated decision becomes portable `presentation.blocks` callback buttons.

Evaluation has a configurable timeout, concurrent promise deduplication, and a bounded five-minute result cache. Timeout or any evaluator failure leaves the outgoing payload unchanged.

Telegram dispatches the `oqr` namespace to the plugin's interactive handler. The handler validates the canonical versioned payload, authorization, source message ID, and source message text. It edits the source message with `Selected:\n<value>` and empty buttons, then returns source-bound `submitText`. The first valid selection for a source message wins for five minutes.

The update checker requests public npm package metadata at most once per day and persists only version/timestamp state under OpenClaw's plugin state directory. A second outbound hook offers an update only on Telegram payloads without existing controls. The `oqru` handler accepts canonical stable versions from a recent plugin-issued prompt, inspects the managed install source, and invokes OpenClaw without a shell. Npm installs use `plugins install <package>@<exact-version> --force`; ClawHub installs use `plugins install clawhub:<package>@<exact-version> --force`. The handler then inspects the plugin again and requires both the manifest and managed-install versions to match before recording success. A separate callback is required before invoking `openclaw gateway restart`.

Discord is intentionally absent. Its public interaction result has no generic `submitText` equivalent, so rendering buttons there would create controls that cannot safely continue an arbitrary agent conversation.
