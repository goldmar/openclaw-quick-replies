# Security design

The public reporting policy is in [SECURITY.md](../SECURITY.md).

Quick Replies has two trust boundaries. First, evaluator output is untrusted: it is accepted only for explicit asks and must pass confidence, shape, complete-option-set, label-length, UTF-8 byte-length, and callback encoding checks. Second, Telegram callbacks are untrusted: only canonical `oqr:v1:<base64url>` payloads from authorized senders with source message identity and text can submit an inbound turn.

The managed evaluation run disables tools and message delivery, uses an isolated temporary session, and inherits OpenClaw's model and credential policy. The plugin adds no shell execution, network client, persistent state, update service, or approval mechanism.

A five-minute in-memory cache reduces duplicate model calls. Cache keys include message text, channel, model, and all behaviorally relevant configuration. A separate bounded five-minute map prevents repeated callbacks for the same Telegram source message. Neither is persisted or sent to a plugin-owned service.
