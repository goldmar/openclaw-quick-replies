# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic versioning.

## Unreleased

- Fixed release automation to publish the exact verified tarball to npm and ClawHub.
- Clarified that OpenClaw plugin updates are operator-triggered rather than periodically scheduled by the plugin.

## 0.1.1

- Increased the default evaluator timeout from five seconds to 20 seconds so managed evaluators have enough time to add quick reply buttons before the original message is sent without them.

## 0.1.0

- Added conservative, model-evaluated Telegram quick reply suggestions.
- Added strict canonical `oqr:v1:<base64url>` callbacks with a 42-byte UTF-8 value limit.
- Added authorization, source-context, duplicate-selection, and button-cleanup safeguards.
- Added explicit-ask filtering, a configurable five-second timeout, concurrent request deduplication, and a bounded five-minute decision cache.
- Added public ClawHub/npm packaging, release validation, documentation, screenshots, and security guidance.
- Documented Discord as unsupported until OpenClaw provides a generic inbound-submission callback contract.
