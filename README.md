# OpenClaw Quick Replies

[![CI](https://github.com/goldmar/openclaw-quick-replies/actions/workflows/ci.yml/badge.svg)](https://github.com/goldmar/openclaw-quick-replies/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/openclaw-quick-replies)](https://www.npmjs.com/package/openclaw-quick-replies)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

OpenClaw Quick Replies turns explicit questions and short choice lists into one-tap Telegram buttons. It uses OpenClaw's managed evaluator, validates every suggestion, and sends the original message unchanged whenever evaluation is unavailable, slow, or uncertain.

## Support matrix

| Channel | Status | Notes |
| --- | --- | --- |
| Telegram | Supported | Buttons resolve in place and the selection returns through Telegram's normal inbound agent path. |
| Discord | Unsupported | OpenClaw can render and acknowledge Discord interactions, but its public Discord callback contract cannot submit a generic reply back to the agent. |
| Other channels | Unsupported | The plugin does not decorate or register callbacks for them. |

`openclaw-code-agent` can support Discord because it owns specific, stateful actions. That model cannot safely implement arbitrary quick-reply text. Discord support can be added when OpenClaw exposes a supported generic inbound-submission contract equivalent to Telegram's `submitText` path.

### Suggested replies

![Telegram conversation showing Staging, Production, and Hold off suggested reply buttons](docs/assets/quick-replies-suggestions.png)

### After selection

![Telegram conversation after Staging is selected, with buttons cleared and the agent continuing in context](docs/assets/quick-reply-selected.png)

## Install

OpenClaw 2026.7.1 or newer and Node.js 22.22.3 or newer are required.

From ClawHub:

```bash
openclaw plugins install clawhub:openclaw-quick-replies
openclaw plugins enable openclaw-quick-replies
```

Or directly from npm:

```bash
openclaw plugins install npm:openclaw-quick-replies
openclaw plugins enable openclaw-quick-replies
```

A managed Gateway normally reloads after installation. Otherwise run `openclaw gateway restart`, then verify the plugin with:

```bash
openclaw plugins inspect openclaw-quick-replies --runtime --json
```

## How it works

1. A plain-text Telegram response reaches OpenClaw's `reply_payload_sending` hook.
2. The plugin proceeds only for an explicit question, answer request, or numbered/bulleted choice list.
3. A managed, tool-disabled evaluator proposes a complete set of short answers.
4. Strict validation enforces confidence, suggestion count, label length, and a 42-byte UTF-8 value limit.
5. Telegram renders portable callback buttons using canonical `oqr:v1:<base64url>` payloads.
6. An authorized selection clears the buttons, records the selected value in the original message, and submits source-bound context through Telegram's normal inbound path.

Malformed, oversized, non-canonical, unauthorized, repeated, or source-less callbacks do not submit text. Messages with media, status/reasoning markers, errors, or existing interactive controls are left untouched.

Quick Replies never bypasses or replaces OpenClaw approval controls. A button is ordinary user-authored reply text, not an approval grant.

## Configuration

Defaults require no configuration. Settings belong under `plugins.entries.openclaw-quick-replies.config`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-quick-replies": {
        "enabled": true,
        "config": {
          "maxSuggestions": 6,
          "minConfidence": 0.7,
          "maxInputChars": 1200,
          "maxLabelChars": 24,
          "maxValueBytes": 42,
          "evaluationTimeoutMs": 5000
        }
      }
    }
  }
}
```

| Setting | Default | Range | Purpose |
| --- | ---: | ---: | --- |
| `enabled` | `true` | — | Enables decoration and evaluation. |
| `maxSuggestions` | `6` | 1–10 | Maximum buttons per message. |
| `minConfidence` | `0.7` | 0–1 | Minimum evaluator confidence. |
| `model` | OpenClaw default | `provider/model` | Optional plugin-scoped evaluator override. |
| `maxInputChars` | `1200` | 1–12000 | Longest message evaluated. |
| `maxLabelChars` | `24` | 1–64 | Longest button label. |
| `maxValueBytes` | `42` | 1–42 | Maximum submitted UTF-8 value; 42 is Telegram's safe maximum for this callback format. |
| `evaluationTimeoutMs` | `5000` | 100–30000 | Time budget before the original message proceeds without buttons. |

When `model` is set, OpenClaw requires an explicit plugin LLM policy:

```json
{
  "plugins": {
    "entries": {
      "openclaw-quick-replies": {
        "config": { "model": "provider/model" },
        "llm": {
          "allowModelOverride": true,
          "allowedModels": ["provider/model"]
        }
      }
    }
  }
}
```

Choose a small, low-latency model available in `openclaw models list`. Each eligible outbound prompt can create one additional model call, so usage, latency, and cost follow that provider. Identical concurrent evaluations share one request, and results are cached for five minutes by message, channel, model, and relevant configuration.

## Privacy and security

The evaluator receives the outgoing Telegram message text and channel name. It runs in an isolated temporary session with tools and message delivery disabled. Do not use Quick Replies on conversations whose outbound text must not be sent to the configured model provider.

Callback values are self-contained; the plugin does not store reply text in a remote service. Recent source-message identifiers are retained in process memory for five minutes only to prevent duplicate submission. See the [security policy](https://github.com/goldmar/openclaw-quick-replies/blob/main/SECURITY.md) for reporting and security boundaries.

## Updates

Quick Replies uses OpenClaw's native update flow:

```bash
openclaw plugins update openclaw-quick-replies
```

Use the same source selector you installed from if OpenClaw asks for one. There is no plugin-owned updater or update telemetry.

## Troubleshooting

- No buttons: confirm the destination is Telegram, the message explicitly asks for an answer, and `openclaw plugins inspect openclaw-quick-replies --runtime --json` shows the hook and interactive handler.
- Model override rejected: add the exact `provider/model` value to the plugin's `llm.allowedModels` list.
- Slow messages: lower `evaluationTimeoutMs` or choose a faster model. On timeout, the original message is still delivered without buttons.
- Some choices are missing: the evaluator must return every numbered/bulleted option when the list fits `maxSuggestions`; incomplete sets are suppressed.
- A tap does nothing: only authorized Telegram senders with intact source message text and identity can submit a quick reply. Stale or malformed callbacks fail closed.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm proof:quick-replies:all
pnpm release:check
```

See the [contributor guide](https://github.com/goldmar/openclaw-quick-replies/blob/main/.github/CONTRIBUTING.md), [development guide](https://github.com/goldmar/openclaw-quick-replies/blob/main/docs/DEVELOPMENT.md), and [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE).
