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

export class ManagedAgentQuickReplyEvaluator implements QuickReplyEvaluator {
  constructor(
    private readonly api: EvaluatorHost,
    private readonly config: QuickReplyConfig,
  ) {}

  async evaluate(input: QuickReplyEvaluationInput): Promise<QuickReplyEvaluationResult> {
    const runEmbeddedAgent = this.api.runtime?.agent?.runEmbeddedAgent;
    if (typeof runEmbeddedAgent !== "function") return failure("evaluator_unavailable");

    try {
      assertConfiguredModelAllowed(this.config.model, this.api.config);
      const model = splitModelRef(this.config.model);
      const id = randomUUID();
      const sessionDir = await mkdtemp(join(tmpdir(), "openclaw-quick-replies-"));
      try {
        const result = await runEmbeddedAgent({
          sessionId: `quick-replies-${id}`,
          sessionFile: join(sessionDir, "session.json"),
          workspaceDir: process.cwd(),
          config: this.api.config,
          prompt: evaluationPrompt(input),
          timeoutMs: this.config.evaluationTimeoutMs,
          runTimeoutOverrideMs: this.config.evaluationTimeoutMs,
          runId: `quick-replies-${id}`,
          trigger: "manual",
          ...(model ? { provider: model.provider, model: model.model } : {}),
          ...(model?.harness ? { agentHarnessRuntimeOverride: model.harness } : {}),
          disableTools: true,
          disableMessageTool: true,
          toolsAllow: [],
          bootstrapContextMode: "lightweight",
          verboseLevel: "off",
          reasoningLevel: "off",
          silentExpected: true,
        });
        const text = collectPayloadText(result);
        if (!text) return failure("evaluator_invalid_json");
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return failure("evaluator_invalid_json");
        }
        const decision = validateEvaluatorDecision(parsed, this.config);
        return decision ? { decision } : failure("evaluator_invalid_decision");
      } finally {
        await rm(sessionDir, { recursive: true, force: true });
      }
    } catch (error) {
      return failure(isDeniedError(error) ? "evaluator_denied" : "evaluator_error");
    }
  }
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
