# Architecture

Quick Replies is a Telegram-only OpenClaw hook plugin.

The `reply_payload_sending` hook rejects unsupported channels, non-plain payloads, existing controls, long input, and messages without an explicit ask. Eligible text is evaluated through `api.runtime.agent.runEmbeddedAgent` with tools and delivery disabled. The validated decision becomes portable `presentation.blocks` callback buttons.

Evaluation has a configurable timeout, concurrent promise deduplication, and a bounded five-minute result cache. Timeout or any evaluator failure leaves the outgoing payload unchanged.

Telegram dispatches the `oqr` namespace to the plugin's interactive handler. The handler validates the canonical versioned payload, authorization, source message ID, and source message text. It edits the source message with `Selected:\n<value>` and empty buttons, then returns source-bound `submitText`. The first valid selection for a source message wins for five minutes.

Discord is intentionally absent. Its public interaction result has no generic `submitText` equivalent, so rendering buttons there would create controls that cannot safely continue an arbitrary agent conversation.
