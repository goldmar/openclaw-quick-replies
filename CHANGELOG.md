# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic versioning.

## Unreleased

- Fixed token-backed ClawHub publishing to use the CLI's documented temporary configuration file while keeping the repository secret out of artifacts and logs.
- Fixed self-updates to force-reinstall the approved exact version from the existing npm or ClawHub source, verify the resulting installed version, and log privacy-safe Telegram callback outcomes before offering a separately authorized Gateway restart.

## 0.1.2

- Added a daily, non-blocking update check that offers authorized Telegram controls for installing the exact approved version through OpenClaw's native plugin manager, preserving both npm and ClawHub install sources, and separately confirming a Gateway restart.
- Added an `updateChecks` setting, enabled by default, and documented the npm registry metadata request used by the checker.
- Fixed release automation to publish the exact verified tarball to npm and ClawHub, retain verified artifacts through delayed environment approval, and attribute the pre-tag ClawHub dry run to the exact commit without claiming a not-yet-created release ref.
- Clarified how operator-triggered and centrally scheduled native plugin updates work.
- Made Gateway restart confirmations single-use with a one-hour expiry, and suppressed update notices whenever Telegram channel data already contains interactive controls.

## 0.1.1

- Increased the default evaluator timeout from five seconds to 20 seconds so managed evaluators have enough time to add quick reply buttons before the original message is sent without them.

## 0.1.0

- Added conservative, model-evaluated Telegram quick reply suggestions.
- Added strict canonical `oqr:v1:<base64url>` callbacks with a 42-byte UTF-8 value limit.
- Added authorization, source-context, duplicate-selection, and button-cleanup safeguards.
- Added explicit-ask filtering, a configurable five-second timeout, concurrent request deduplication, and a bounded five-minute decision cache.
- Added public ClawHub/npm packaging, release validation, documentation, screenshots, and security guidance.
- Documented Discord as unsupported until OpenClaw provides a generic inbound-submission callback contract.
