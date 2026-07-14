# Reference

## Runtime contracts

- Plugin ID: `openclaw-quick-replies`
- OpenClaw API floor: `>=2026.7.1`
- Gateway floor: `2026.7.1`
- Node.js floor: `>=22.22.3`
- Supported channel: `telegram`
- Hook: `reply_payload_sending`
- Interactive namespaces: `oqr` and `oqru`
- Callback form: `oqr:v1:<base64url>`
- Update callback forms: `oqru:v1:install:<stable-version>` and `oqru:v1:restart:<stable-version>`
- Maximum callback value: 42 UTF-8 bytes

## Public config

The public keys are `enabled`, `maxSuggestions`, `minConfidence`, `model`, `maxInputChars`, `maxLabelChars`, `maxValueBytes`, `evaluationTimeoutMs`, and `updateChecks`. Their defaults and ranges are defined in `openclaw.plugin.json` and summarized in the README.

## Suppression rules

The plugin suppresses non-Telegram delivery, empty or oversized text, media, voice/TTS supplements, errors, reasoning/commentary, status/fallback/compaction notices, existing portable controls, channel-native controls, non-explicit asks, evaluator failures, low confidence, invalid suggestions, incomplete explicit option sets, and values that cannot fit the callback contract.

## Evaluation diagnostics

`evaluation_started`, `evaluation_cache_hit`, and `evaluation_pending_hit` describe evaluator dispatch. `evaluator_completed` reports bounded setup, embedded-run, validation, and total milliseconds plus the model and outcome; `evaluator_cleanup` reports temporary-directory cleanup. Final `decorated` and `suppressed` records include evaluation and total synchronous hook milliseconds where applicable. Diagnostics never include the evaluated text or raw model response, and they do not include downstream Telegram delivery time.

## Callback rules

The handler rejects wrong namespaces or versions, padding, invalid base64url characters, invalid UTF-8, non-canonical encodings, leading/trailing whitespace, values over 42 bytes, unauthorized senders, missing source context, and repeated source-message selections.

Update callbacks additionally require a canonical stable version and recent matching prompt state. Installation force-reinstalls the exact approved version from the existing managed npm or ClawHub source, verifies the resulting manifest version, and cross-checks the install-record version when present. Repeated installs, unprompted versions, expired prompts, unverified installs, and restart callbacks without a completed matching install are rejected.
