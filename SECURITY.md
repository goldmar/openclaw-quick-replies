# Security policy

## Supported versions

Security fixes are provided for the latest published version of OpenClaw Quick Replies.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a public issue containing exploit details, callback payloads tied to private conversations, credentials, tokens, or personal data.

Include the affected version, OpenClaw version, channel, reproduction steps, impact, and any suggested mitigation. You should receive an acknowledgement within seven days. Disclosure timing will be coordinated after a fix is available.

For ordinary bugs and support questions, use the repository issue templates instead.

## Security boundaries

- Quick Replies supports Telegram only and requires OpenClaw 2026.7.1 or newer.
- The evaluator receives outbound message text and the channel name. It runs through OpenClaw's managed agent runtime with tools and message delivery disabled.
- Evaluation output is untrusted and must pass schema, confidence, count, length, byte-budget, and callback validation.
- Callback values use canonical `oqr:v1:<base64url>` data and are limited to 42 UTF-8 bytes.
- Unauthorized, malformed, repeated, and source-less callbacks do not submit agent input.
- Quick replies are ordinary inbound text and never replace OpenClaw approvals or authorization policy.
- The optional update checker requests public npm metadata at most once per day and sends no conversation content, user identifier, or configuration.
- Update controls accept only a recent prompted stable version, install that exact version through OpenClaw's native updater, and require a separate authorized Gateway-restart confirmation.
- The plugin contains no registry credential, remote callback store, shell command, or unattended installation path.
