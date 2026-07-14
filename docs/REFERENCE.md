# Reference

## Runtime contracts

- Plugin ID: `openclaw-quick-replies`
- OpenClaw API floor: `>=2026.7.1`
- Gateway floor: `2026.7.1`
- Node.js floor: `>=22.22.3`
- Supported channel: `telegram`
- Hook: `reply_payload_sending`
- Interactive namespace: `oqr`
- Callback form: `oqr:v1:<base64url>`
- Maximum callback value: 42 UTF-8 bytes

## Public config

The public keys are `enabled`, `maxSuggestions`, `minConfidence`, `model`, `maxInputChars`, `maxLabelChars`, `maxValueBytes`, and `evaluationTimeoutMs`. Their defaults and ranges are defined in `openclaw.plugin.json` and summarized in the README.

## Suppression rules

The plugin suppresses non-Telegram delivery, empty or oversized text, media, voice/TTS supplements, errors, reasoning/commentary, status/fallback/compaction notices, existing portable controls, channel-native controls, non-explicit asks, evaluator failures, low confidence, invalid suggestions, incomplete explicit option sets, and values that cannot fit the callback contract.

## Callback rules

The handler rejects wrong namespaces or versions, padding, invalid base64url characters, invalid UTF-8, non-canonical encodings, leading/trailing whitespace, values over 42 bytes, unauthorized senders, missing source context, and repeated source-message selections.
