import { createHash } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type {
  PluginHookReplyPayload,
  PluginHookReplyPayloadSendingContext,
  PluginHookReplyPayloadSendingEvent,
  PluginHookReplyPayloadSendingResult,
} from "openclaw/plugin-sdk/core";
import { buildSuggestionCallbackData } from "./callbacks";
import { isRecord, resolveQuickReplyConfig } from "./config";
import { ManagedAgentQuickReplyEvaluator } from "./evaluator";
import type {
  QuickReplyConfig,
  QuickReplyDecision,
  QuickReplyDiagnosticReason,
  QuickReplyEvaluationInput,
  QuickReplyEvaluationResult,
  QuickReplyEvaluator,
} from "./types";

type QuickReplyHookDependencies = {
  evaluator?: QuickReplyEvaluator;
  now?: () => number;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

type CacheEntry = {
  result: QuickReplyEvaluationResult;
  expiresAt: number;
};

const DIRECT_BUTTON_LABEL_MAX_CHARS = 18;
const DECISION_CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 500;

export function createQuickReplyPayloadHook(api: OpenClawPluginApi, deps: QuickReplyHookDependencies = {}) {
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<QuickReplyEvaluationResult>>();

  return async (
    event: PluginHookReplyPayloadSendingEvent,
    ctx: PluginHookReplyPayloadSendingContext,
  ): Promise<PluginHookReplyPayloadSendingResult | void> => {
    const channel = event.channel ?? ctx.channelId;
    const config = resolveQuickReplyConfig(api.pluginConfig);
    logDiagnostic(deps, "hook_seen", {
      hook: "reply_payload_sending",
      channel,
      messageId: ctx.messageId,
      runId: event.runId ?? ctx.runId,
    });

    if (channel !== "telegram") {
      logDiagnostic(deps, "suppressed", { reason: "unsupported_channel", channel });
      return;
    }

    const skipReason = structuralSkipReason(event.payload, config);
    if (skipReason) {
      logDiagnostic(deps, "suppressed", { reason: skipReason });
      return;
    }

    const text = event.payload.text!.trim();
    if (!isExplicitReplyAsk(text)) {
      logDiagnostic(deps, "suppressed", { reason: "not_explicit_ask" });
      return;
    }

    const input: QuickReplyEvaluationInput = {
      text,
      channel: "telegram",
      sessionKey: event.sessionKey ?? ctx.sessionKey,
      runId: event.runId ?? ctx.runId,
      messageId: ctx.messageId,
      maxSuggestions: config.maxSuggestions,
      maxLabelChars: config.maxLabelChars,
      maxValueBytes: config.maxValueBytes,
    };

    const result = await resolveDecision({ api, cache, config, deps, input, pending });
    if (!result.decision?.eligible) {
      logDiagnostic(deps, "suppressed", {
        reason: result.failureReason ?? result.decision?.reason ?? "no_decision",
      });
      return;
    }

    if (hasIncompleteExplicitOptionSet(text, result.decision, config.maxSuggestions)) {
      logDiagnostic(deps, "suppressed", {
        reason: "evaluator_invalid_decision",
        expectedSuggestions: explicitAnswerOptionCount(text),
        suggestions: result.decision.suggestions.length,
      });
      return;
    }

    const decorated = decoratePayload(event.payload, result.decision);
    if (!decorated) return;
    logDiagnostic(deps, "decorated", { suggestions: result.decision.suggestions.length });
    return { payload: decorated };
  };
}

function structuralSkipReason(
  payload: PluginHookReplyPayload,
  config: QuickReplyConfig,
): QuickReplyDiagnosticReason | null {
  if (!config.enabled) return "disabled";
  if (typeof payload.text !== "string" || !payload.text.trim()) return "empty_text";
  if (payload.text.length > config.maxInputChars) return "input_budget";
  if (
    payload.mediaUrl ||
    payload.mediaUrls?.length ||
    payload.audioAsVoice ||
    payload.spokenText ||
    payload.ttsSupplement ||
    payload.isError ||
    payload.isReasoning ||
    payload.isCommentary ||
    payload.isCompactionNotice ||
    payload.isFallbackNotice ||
    payload.isStatusNotice
  ) {
    return "non_plain_text";
  }
  if (hasExistingInteractivity(payload)) return "existing_interactivity";
  return null;
}

async function resolveDecision(params: {
  api: OpenClawPluginApi;
  cache: Map<string, CacheEntry>;
  config: QuickReplyConfig;
  deps: QuickReplyHookDependencies;
  input: QuickReplyEvaluationInput;
  pending: Map<string, Promise<QuickReplyEvaluationResult>>;
}): Promise<QuickReplyEvaluationResult> {
  const { api, cache, config, deps, input, pending } = params;
  const key = decisionCacheKey(input, config);
  const now = deps.now?.() ?? Date.now();
  pruneCache(cache, now);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  const existing = pending.get(key);
  if (existing) return existing;

  const evaluator = deps.evaluator ?? new ManagedAgentQuickReplyEvaluator(api, config);
  const evaluation = evaluateWithTimeout(evaluator, input, config.evaluationTimeoutMs)
    .then((result) => {
      const completedAt = deps.now?.() ?? Date.now();
      cache.set(key, { result, expiresAt: completedAt + DECISION_CACHE_TTL_MS });
      trimOldestEntries(cache, MAX_CACHE_ENTRIES);
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, evaluation);
  return evaluation;
}

async function evaluateWithTimeout(
  evaluator: QuickReplyEvaluator,
  input: QuickReplyEvaluationInput,
  timeoutMs: number,
): Promise<QuickReplyEvaluationResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<QuickReplyEvaluationResult>((resolve) => {
    timer = setTimeout(() => resolve({ decision: null, failureReason: "evaluator_timeout" }), timeoutMs);
  });
  const evaluation = evaluator.evaluate(input).catch(() => ({
    decision: null,
    failureReason: "evaluator_error" as const,
  }));
  try {
    return await Promise.race([evaluation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function decoratePayload(
  payload: PluginHookReplyPayload,
  decision: QuickReplyDecision,
): PluginHookReplyPayload | null {
  const needsVisibleMeanings = decision.suggestions.some(needsVisibleMeaning);
  const buttons = decision.suggestions.flatMap((suggestion, index) => {
    const callbackData = buildSuggestionCallbackData(suggestion.value);
    if (!callbackData) return [];
    return [{
      label: needsVisibleMeanings && needsVisibleMeaning(suggestion) ? String(index + 1) : suggestion.label,
      action: { type: "callback" as const, value: callbackData },
    }];
  });
  if (buttons.length !== decision.suggestions.length) return null;

  const visibleMeanings = needsVisibleMeanings ? visibleMeaningsText(decision.suggestions) : null;
  const existingBlocks = payload.presentation?.blocks ?? [];
  return {
    ...payload,
    ...(visibleMeanings ? { text: textWithVisibleMeanings(payload.text!, visibleMeanings) } : {}),
    presentation: {
      ...payload.presentation,
      blocks: [
        ...existingBlocks,
        ...(visibleMeanings ? [{ type: "text" as const, text: visibleMeanings }] : []),
        { type: "buttons", buttons },
      ],
    },
  };
}

function needsVisibleMeaning(suggestion: { label: string; value: string }): boolean {
  return normalizePresentationText(suggestion.label) !== normalizePresentationText(suggestion.value) ||
    suggestion.label.length > DIRECT_BUTTON_LABEL_MAX_CHARS;
}

function visibleMeaningsText(suggestions: Array<{ value: string }>): string {
  return ["Quick replies:", ...suggestions.map((suggestion, index) => `${index + 1}. ${suggestion.value}`)].join("\n");
}

function textWithVisibleMeanings(text: string, visibleMeanings: string): string {
  if (text.includes(visibleMeanings)) return text;
  if (/Quick replies:\s*$/iu.test(text)) {
    return `${text.trimEnd()}\n${visibleMeanings.replace(/^Quick replies:\n/iu, "")}`;
  }
  return `${text}${text.trim() ? "\n\n" : ""}${visibleMeanings}`;
}

export function isExplicitReplyAsk(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/[?？]/u.test(normalized)) return true;
  if (explicitAnswerOptionCount(normalized)) return true;
  return /^(?:please\s+)?(?:answer|choose|pick|select|reply|respond)(?:\s+(?:to|with))?\b/iu.test(normalized) ||
    /\b(?:can|could|would|will)\s+you\s+(?:answer|choose|pick|select|reply|respond)\b/iu.test(normalized);
}

function hasIncompleteExplicitOptionSet(
  text: string,
  decision: QuickReplyDecision,
  maxSuggestions: number,
): boolean {
  const count = explicitAnswerOptionCount(text);
  return Boolean(count && count <= maxSuggestions && decision.suggestions.length !== count);
}

function explicitAnswerOptionCount(text: string): number | null {
  const numbered: number[] = [];
  let bullets = 0;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = /^(\d{1,2})[.)]\s+\S/u.exec(line);
    if (match) {
      numbered.push(Number(match[1]));
    } else if (/^[-*]\s+\S/u.test(line)) {
      bullets += 1;
    }
  }
  if (numbered.length >= 2 && numbered.every((value, index) => value === index + 1)) return numbered.length;
  return bullets >= 2 ? bullets : null;
}

function hasExistingInteractivity(payload: PluginHookReplyPayload): boolean {
  if (payload.btw || payload.interactive?.blocks.length) return true;
  if (payload.presentation?.blocks.some((block) => block.type === "buttons" || block.type === "select")) return true;
  return hasControlLikeChannelData(payload.channelData);
}

function hasControlLikeChannelData(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const stack: unknown[] = [raw];
  while (stack.length > 0) {
    const next = stack.pop();
    if (Array.isArray(next)) {
      stack.push(...next);
      continue;
    }
    if (!isRecord(next)) continue;
    for (const [key, value] of Object.entries(next)) {
      if (["buttons", "reply_markup", "inline_keyboard", "components"].includes(key) && value) return true;
      if (isRecord(value) || Array.isArray(value)) stack.push(value);
    }
  }
  return false;
}

function decisionCacheKey(input: QuickReplyEvaluationInput, config: QuickReplyConfig): string {
  const material = JSON.stringify({
    text: input.text,
    messageId: input.messageId ?? "",
    channel: input.channel,
    model: config.model ?? "",
    maxSuggestions: config.maxSuggestions,
    minConfidence: config.minConfidence,
    maxInputChars: config.maxInputChars,
    maxLabelChars: config.maxLabelChars,
    maxValueBytes: config.maxValueBytes,
    evaluationTimeoutMs: config.evaluationTimeoutMs,
  });
  return createHash("sha256").update(material).digest("base64url");
}

function normalizePresentationText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function pruneCache(cache: Map<string, CacheEntry>, now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  trimOldestEntries(cache, MAX_CACHE_ENTRIES);
}

function trimOldestEntries<T>(map: Map<string, T>, maxEntries: number): void {
  while (map.size > maxEntries) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function logDiagnostic(deps: QuickReplyHookDependencies, event: string, fields: Record<string, unknown>): void {
  if (!deps.log) return;
  const compacted = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  deps.log(event, compacted);
}
