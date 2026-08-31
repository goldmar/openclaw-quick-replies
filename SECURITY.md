# Security policy

## Supported versions

OpenClaw Quick Replies is discontinued. No published version receives security fixes or compatibility updates.

Users should uninstall the plugin and migrate to OpenClaw 2026.8.1 or newer, which provides native structured questions through `ask_user` and supported agent-harness bridges.

## Reporting a vulnerability

Security issues in current OpenClaw belong in the [OpenClaw security process](https://github.com/openclaw/openclaw/security). For a vulnerability specific to this historical package, use this repository's private vulnerability reporting if available. Do not open a public issue containing exploit details, credentials, tokens, private conversation data, callback payloads tied to private conversations, or personal data.

A report may help downstream forks and historical analysis, but this discontinued project does not promise a patch or release.

## Historical security boundaries

The final runtime is unchanged from v0.1.6. It is Telegram-only, makes an additional model request for eligible outgoing messages, submits selected callback values as ordinary inbound text, and uses process-local duplicate suppression. Its former architecture and security documentation remain in the immutable [v0.1.6 source tree](https://github.com/goldmar/openclaw-quick-replies/tree/v0.1.6).
