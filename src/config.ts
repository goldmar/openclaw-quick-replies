import { buildSuggestionCallbackData } from "./callbacks";
import type { QuickReplyConfig, QuickReplyDecision, QuickReplySuggestion, QuickReplyThinkLevel } from "./types";

export const QUICK_REPLY_THINK_LEVELS = [
  "off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max", "ultra",
] as const satisfies readonly QuickReplyThinkLevel[];

export const DEFAULT_CONFIG: QuickReplyConfig = {
  enabled: true,
  maxSuggestions: 6,
  minConfidence: 0.7,
  thinkLevel: "minimal",
  maxInputChars: 1200,
  maxLabelChars: 24,
  maxValueBytes: 42,
  evaluationTimeoutMs: 20_000,
  updateChecks: true,
};

export function resolveQuickReplyConfig(raw: unknown): QuickReplyConfig {
  const value = isRecord(raw) ? raw : {};
  return {
    enabled: readBoolean(value.enabled, DEFAULT_CONFIG.enabled),
    maxSuggestions: readInteger(value.maxSuggestions, DEFAULT_CONFIG.maxSuggestions, 1, 10),
    minConfidence: readNumber(value.minConfidence, DEFAULT_CONFIG.minConfidence, 0, 1),
    model: readOptionalString(value.model),
    thinkLevel: readThinkLevel(value.thinkLevel, DEFAULT_CONFIG.thinkLevel),
    maxInputChars: readInteger(value.maxInputChars, DEFAULT_CONFIG.maxInputChars, 1, 12_000),
    maxLabelChars: readInteger(value.maxLabelChars, DEFAULT_CONFIG.maxLabelChars, 1, 64),
    maxValueBytes: readInteger(value.maxValueBytes, DEFAULT_CONFIG.maxValueBytes, 1, 42),
    evaluationTimeoutMs: readInteger(value.evaluationTimeoutMs, DEFAULT_CONFIG.evaluationTimeoutMs, 100, 30_000),
    updateChecks: readBoolean(value.updateChecks, DEFAULT_CONFIG.updateChecks),
  };
}

function readThinkLevel(raw: unknown, fallback: QuickReplyThinkLevel): QuickReplyThinkLevel {
  return typeof raw === "string" && (QUICK_REPLY_THINK_LEVELS as readonly string[]).includes(raw)
    ? raw as QuickReplyThinkLevel
    : fallback;
}

export function validateEvaluatorDecision(raw: unknown, config: QuickReplyConfig): QuickReplyDecision | null {
  if (!isRecord(raw) || typeof raw.eligible !== "boolean") return null;
  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
    ? Math.min(1, Math.max(0, raw.confidence))
    : 0;
  const reason = typeof raw.reason === "string" ? raw.reason.slice(0, 80) : undefined;
  if (!raw.eligible || confidence < config.minConfidence) {
    return { eligible: false, confidence, suggestions: [], reason };
  }
  if (!Array.isArray(raw.suggestions)) return null;

  const suggestions: QuickReplySuggestion[] = [];
  for (const rawSuggestion of raw.suggestions) {
    const suggestion = validateSuggestion(rawSuggestion, config);
    if (!suggestion) return null;
    suggestions.push(suggestion);
  }
  if (suggestions.length === 0 || suggestions.length > config.maxSuggestions) return null;
  return { eligible: true, confidence, suggestions, reason };
}

function validateSuggestion(raw: unknown, config: QuickReplyConfig): QuickReplySuggestion | null {
  if (!isRecord(raw) || typeof raw.label !== "string" || typeof raw.value !== "string") return null;
  const label = normalizeSuggestionText(raw.label);
  const value = normalizeSuggestionText(raw.value);
  if (!label || !value || hasListMarkerPrefix(label) || hasListMarkerPrefix(value)) return null;
  if (label.length > config.maxLabelChars || Buffer.byteLength(value, "utf8") > config.maxValueBytes) return null;
  if (!buildSuggestionCallbackData(value)) return null;
  return { label, value };
}

function normalizeSuggestionText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function hasListMarkerPrefix(value: string): boolean {
  return /^(?:[-*]\s+|\d{1,2}[.)]\s+)/u.test(value);
}

function readBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function readNumber(raw: unknown, fallback: number, min: number, max: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback;
}

function readInteger(raw: unknown, fallback: number, min: number, max: number): number {
  return Number.isInteger(raw) ? Math.min(max, Math.max(min, raw as number)) : fallback;
}

function readOptionalString(raw: unknown): string | undefined {
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
