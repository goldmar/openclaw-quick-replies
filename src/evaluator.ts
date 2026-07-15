import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { validateEvaluatorDecision } from "./config";
import type {
  QuickReplyConfig,
  QuickReplyEvaluationInput,
  QuickReplyEvaluationResult,
  QuickReplyEvaluator,
} from "./types";

type EvaluatorHost = Pick<OpenClawPluginApi, "config" | "runtime">;
type DiagnosticLogger = (event: string, fields: Record<string, unknown>) => void;

export class ManagedAgentQuickReplyEvaluator implements QuickReplyEvaluator {
  constructor(
    private readonly api: EvaluatorHost,
    private readonly config: QuickReplyConfig,
    private readonly log?: DiagnosticLogger,
  ) {}

  async evaluate(input: QuickReplyEvaluationInput): Promise<QuickReplyEvaluationResult> {
    const runEmbeddedAgent = this.api.runtime?.agent?.runEmbeddedAgent;
    if (typeof runEmbeddedAgent !== "function") return failure("evaluator_unavailable");

    const startedAt = performance.now();
    try {
      assertConfiguredModelAllowed(this.config.model, this.api.config);
      const model = splitModelRef(this.config.model);
      const policyModel = model ?? resolveDefaultModelRef(this.api);
      if (!supportsConfiguredThinkLevel(this.api, policyModel, this.config.thinkLevel)) {
        this.logTiming("evaluator_completed", startedAt, { outcome: "evaluator_unsupported_think_level" });
        return failure("evaluator_unsupported_think_level");
      }
      const id = randomUUID();
      const setupStartedAt = performance.now();
      const sessionDir = await mkdtemp(join(tmpdir(), "openclaw-quick-replies-"));
      const setupMs = elapsedMs(setupStartedAt);
      try {
        const runStartedAt = performance.now();
        const result = await runEmbeddedAgent({
          sessionId: `quick-replies-${id}`,
          sessionKey: `temp:quick-replies:${id}`,
          sessionFile: join(sessionDir, "session.json"),
          workspaceDir: process.cwd(),
          config: configWithoutUserMcpServers(this.api.config),
          prompt: evaluationPrompt(input),
          timeoutMs: this.config.evaluationTimeoutMs,
          runTimeoutOverrideMs: this.config.evaluationTimeoutMs,
          runId: `quick-replies-${id}`,
          trigger: "manual",
          ...(model ? { provider: model.provider, model: model.model } : {}),
          ...(model?.harness ? { agentHarnessRuntimeOverride: model.harness } : {}),
          thinkLevel: this.config.thinkLevel,
          disableTools: true,
          disableMessageTool: true,
          toolsAllow: [],
          bootstrapContextMode: "lightweight",
          verboseLevel: "off",
          reasoningLevel: "off",
          silentExpected: true,
          modelRun: true,
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        });
        const runMs = elapsedMs(runStartedAt);
        const validationStartedAt = performance.now();
        const text = collectPayloadText(result);
        if (!text) {
          this.logTiming("evaluator_completed", startedAt, { setupMs, runMs, validationMs: elapsedMs(validationStartedAt), outcome: "evaluator_invalid_json" });
          return failure("evaluator_invalid_json");
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          this.logTiming("evaluator_completed", startedAt, { setupMs, runMs, validationMs: elapsedMs(validationStartedAt), outcome: "evaluator_invalid_json" });
          return failure("evaluator_invalid_json");
        }
        const decision = validateEvaluatorDecision(parsed, this.config);
        this.logTiming("evaluator_completed", startedAt, {
          setupMs,
          runMs,
          validationMs: elapsedMs(validationStartedAt),
          outcome: decision ? (decision.eligible ? "eligible" : "ineligible") : "evaluator_invalid_decision",
        });
        return decision ? { decision } : failure("evaluator_invalid_decision");
      } finally {
        const cleanupStartedAt = performance.now();
        await rm(sessionDir, { recursive: true, force: true });
        this.log?.("evaluator_cleanup", { cleanupMs: elapsedMs(cleanupStartedAt) });
      }
    } catch (error) {
      const outcome = isDeniedError(error) ? "evaluator_denied" : "evaluator_error";
      this.logTiming("evaluator_completed", startedAt, { outcome });
      return failure(outcome);
    }
  }

  private logTiming(event: string, startedAt: number, fields: Record<string, unknown>): void {
    this.log?.(event, { ...fields, totalMs: elapsedMs(startedAt), model: this.config.model ?? "default" });
  }
}

function supportsConfiguredThinkLevel(
  api: EvaluatorHost,
  model: { provider: string; model: string; harness?: string },
  thinkLevel: QuickReplyConfig["thinkLevel"],
): boolean {
  const normalizeThinkingLevel = api.runtime?.agent?.normalizeThinkingLevel;
  const resolveThinkingPolicy = api.runtime?.agent?.resolveThinkingPolicy;
  if (typeof normalizeThinkingLevel !== "function" || typeof resolveThinkingPolicy !== "function") return false;
  const normalized = normalizeThinkingLevel(thinkLevel);
  if (normalized !== thinkLevel) return false;
  const policy = resolveThinkingPolicy({
    provider: model.provider,
    model: model.model,
    ...(model.harness ? { agentRuntime: model.harness } : {}),
  });
  return policy.levels.some((level) => level.id === normalized);
}

function resolveDefaultModelRef(api: EvaluatorHost): { provider: string; model: string; harness?: string } {
  const configured = readDefaultModelRef(api.config);
  if (configured) return splitModelRef(configured)!;
  const provider = api.runtime?.agent?.defaults?.provider;
  const model = api.runtime?.agent?.defaults?.model;
  if (typeof provider !== "string" || !provider || typeof model !== "string" || !model) {
    throw new Error("default evaluator model could not be resolved");
  }
  return splitModelRef(`${provider}/${model}`)!;
}

function readDefaultModelRef(config: unknown): string | undefined {
  if (!isRecord(config) || !isRecord(config.agents) || !isRecord(config.agents.defaults)) return undefined;
  const model = config.agents.defaults.model;
  if (typeof model === "string" && model.trim()) return model.trim();
  return isRecord(model) && typeof model.primary === "string" && model.primary.trim() ? model.primary.trim() : undefined;
}

export function configWithoutUserMcpServers<T>(config: T): T {
  if (!isRecord(config) || !isRecord(config.mcp) || !("servers" in config.mcp)) return config;
  const { servers: _servers, ...mcp } = config.mcp;
  return { ...config, mcp } as T;
}

function evaluationPrompt(input: QuickReplyEvaluationInput): string {
  const system = [
    "Decide whether this outgoing Telegram message should get quick reply buttons.",
    "Return JSON only, without markdown.",
    "Only return eligible true when the message explicitly asks the user for an answer now.",
    "Use the complete explicit answer space. For numbered or bulleted choices within the limit, return exactly one suggestion per choice and preserve every choice.",
    "Do not create buttons for status reports, completion summaries, broad advice, generic next steps, or open-ended questions without short useful answers.",
    "Do not prefix labels or values with list markers.",
    `Return at most ${input.maxSuggestions} suggestions.`,
    `Keep each label at or under ${input.maxLabelChars} characters and each UTF-8 value at or under ${input.maxValueBytes} bytes.`,
    'Use this shape: {"eligible":boolean,"confidence":number,"reason":string,"suggestions":[{"label":string,"value":string}]}.',
  ].join(" ");
  return `SYSTEM:\n${system}\n\nUSER:\n${JSON.stringify({ text: input.text, channel: input.channel })}`;
}

function assertConfiguredModelAllowed(modelRef: string | undefined, config: unknown): void {
  if (!modelRef) return;
  const policy = readPluginLlmPolicy(config);
  if (!policy || policy.allowModelOverride !== true) {
    throw new Error("configured evaluator model override is not allowed by plugin LLM policy");
  }
  if (Array.isArray(policy.allowedModels) && !policy.allowedModels.includes("*") && !policy.allowedModels.includes(modelRef)) {
    throw new Error(`configured evaluator model is not in plugin LLM allowlist: ${modelRef}`);
  }
}

function readPluginLlmPolicy(config: unknown): { allowModelOverride?: unknown; allowedModels?: unknown } | null {
  if (!isRecord(config) || !isRecord(config.plugins) || !isRecord(config.plugins.entries)) return null;
  const entry = config.plugins.entries["openclaw-quick-replies"];
  return isRecord(entry) && isRecord(entry.llm) ? entry.llm : null;
}

function splitModelRef(modelRef?: string): { provider: string; model: string; harness?: string } | null {
  if (!modelRef) return null;
  const slash = modelRef.indexOf("/");
  if (slash <= 0 || slash === modelRef.length - 1) throw new Error("configured evaluator model must be provider/model");
  const provider = modelRef.slice(0, slash);
  const model = modelRef.slice(slash + 1);
  return {
    provider,
    model,
    ...(provider === "openai" && /^gpt-[^/]*-luna(?:-|$)/u.test(model) ? { harness: "codex" } : {}),
  };
}

function collectPayloadText(result: unknown): string | null {
  if (!isRecord(result) || !Array.isArray(result.payloads)) return null;
  const texts = result.payloads.flatMap((payload) =>
    isRecord(payload) && typeof payload.text === "string" && payload.text.trim() ? [payload.text.trim()] : []
  );
  return texts.length > 0 ? texts.join("\n") : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(failureReason: QuickReplyEvaluationResult["failureReason"]): QuickReplyEvaluationResult {
  return { decision: null, failureReason };
}

function isDeniedError(error: unknown): boolean {
  const value = error as { code?: unknown; name?: unknown; message?: unknown; status?: unknown; statusCode?: unknown };
  const haystack = [value?.code, value?.name, value?.message].filter((item): item is string => typeof item === "string").join(" ").toLowerCase();
  const status = typeof value?.status === "number" ? value.status : value?.statusCode;
  return status === 401 || status === 403 || /denied|forbidden|unauthorized|permission/u.test(haystack);
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
