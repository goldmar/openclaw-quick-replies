# OpenClaw Quick Replies

> [!IMPORTANT]
> **This project was discontinued on August 31, 2026, after OpenClaw 2026.8.1 added native structured questions.** Do not install this plugin on a current OpenClaw system. No further compatibility, security, or feature releases are planned.

OpenClaw Quick Replies filled a real gap in OpenClaw 2026.7.1: it inspected outgoing Telegram questions, made a second model call to infer likely answers, and added one-tap callback buttons. OpenClaw 2026.8.1 now owns that interaction end to end through its native `ask_user` question runtime and the `request_user_input` bridges used by supported agent harnesses.

The final plugin release is [v0.1.7](https://github.com/goldmar/openclaw-quick-replies/releases/tag/v0.1.7), built and tested against OpenClaw 2026.7.1-2. Its source remains available under the MIT license for historical reference and forks, but it is no longer maintained or recommended.

## Why it was discontinued

[OpenClaw 2026.8.1](https://github.com/openclaw/openclaw/releases/tag/v2026.8.1) introduced a first-party structured-question system for the same user need. The agent can pause its turn, ask a question with declared choices, wait for a validated answer, and resume with that answer through an OpenClaw-owned Gateway record.

The native implementation is a better long-term owner for this behavior:

| Concern | This plugin | OpenClaw 2026.8.1 |
| --- | --- | --- |
| Question creation | Heuristically analyzes already-written prose | The agent or harness creates an explicit structured question |
| Model use | Adds a separate evaluator request for eligible Telegram messages | Uses the choices already declared by the active agent turn |
| Surfaces | Telegram only | Web, iOS, macOS, Android, and messaging channels |
| Native controls | Telegram callback buttons | Telegram, Discord, and Slack buttons; WhatsApp, Signal, and iMessage reactions |
| Other answers | Only evaluator-generated values | Built-in free-text **Other** path and an explicit **Skip** path |
| Lifecycle | Five-minute process-local duplicate suppression and source-bound reply text | Gateway-owned question identity, answer validation, timeout/cancellation, reconnect recovery, and terminal control cleanup |
| Maintenance | Tracks plugin hooks, embedded-model behavior, Telegram callbacks, and a separate updater | Maintained with OpenClaw's agents, Gateway, channels, and clients |

Continuing the plugin would therefore preserve a second, narrower question system while adding latency, model cost, privacy exposure, and compatibility work. It also deliberately ignores messages that already contain interactive controls, so it adds nothing to native `ask_user` prompts.

The core implementation was completed in three upstream changes:

- [#109922: provider-neutral `ask_user`, Gateway question lifecycle, channel buttons, and text answers](https://github.com/openclaw/openclaw/pull/109922)
- [#110372: Codex and Copilot harness convergence, native apps, reactions, and terminal cleanup](https://github.com/openclaw/openclaw/pull/110372)
- [#130262: reliable native Telegram choices and the `Other…` input path](https://github.com/openclaw/openclaw/pull/130262)

See OpenClaw's [structured-question documentation](https://docs.openclaw.ai/tools/ask-user) and [message-presentation contract](https://docs.openclaw.ai/plugins/message-presentation) for the current behavior.

## What is not identical

The native feature is not a byte-for-byte reimplementation of this plugin. OpenClaw Quick Replies could infer up to ten buttons after an assistant emitted an ordinary prose question. Native `ask_user` requires the agent or harness to create a structured question and allows two to four declared options per question. It is available only to the main session and can be removed by tool policy.

That automatic post-processing behavior remains a narrow capability of the final legacy release, but it is no longer enough to justify a supported plugin. Explicit structured questions are more predictable, preserve the question's identity, avoid a second model judgment, and degrade safely to plain-text answers when a surface cannot render native controls.

## Migrating to native questions

1. Update OpenClaw to 2026.8.1 or newer.
2. Make sure the main agent's tool policy allows `ask_user`.
3. Disable and uninstall this plugin:

   ```bash
   openclaw plugins disable openclaw-quick-replies
   openclaw plugins uninstall openclaw-quick-replies
   ```

4. Let agents use `ask_user` for genuine user-owned decisions. One single-select question receives native buttons on Telegram, Discord, and Slack. More complex question sets retain a readable plain-text answer path. Use OpenClaw's native approval system—not `ask_user`—for execution or plugin approvals.

For the former installation, configuration, architecture, and security documentation, use the immutable [v0.1.6 source tree](https://github.com/goldmar/openclaw-quick-replies/tree/v0.1.6).

## Historical project summary

OpenClaw Quick Replies was a Telegram-only OpenClaw plugin that conservatively added model-generated reply suggestions to explicit questions, cleaned up buttons after selection, and submitted the selected value in the context of the source message. It shipped eight releases from v0.1.0 through the final v0.1.7 documentation release.

## License

MIT. See [LICENSE](LICENSE).
