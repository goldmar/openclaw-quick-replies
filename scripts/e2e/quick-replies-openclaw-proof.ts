#!/usr/bin/env -S node --import tsx
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createQuickReplyPayloadHook,
} from "../../src/decorator";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginHookReplyPayloadSendingContext, PluginHookReplyPayloadSendingEvent } from "openclaw/plugin-sdk/core";
import type { QuickReplyEvaluationResult } from "../../src/types";

type Command = "doctor" | "local-smoke" | "run";

export type QuickRepliesProofOptions = {
  command: Command;
  dryRun: boolean;
  outputDir: string;
};

type DoctorCheck = {
  detail?: string;
  name: string;
  ok: boolean;
  required: boolean;
};

type ProofDeps = {
  exists?: (file: string) => boolean;
};

export type QuickRepliesCoverageRow = {
  category: string;
  coverage: "covered" | "conditional" | "suppressed" | "host_dependent";
  notes: string;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const DEFAULT_OUTPUT_ROOT = ".artifacts/qa-e2e/quick-replies";
const DEFAULT_OUTPUT_ROOT_ABS = path.resolve(REPO_ROOT, DEFAULT_OUTPUT_ROOT);

export function usageText(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/e2e/quick-replies-openclaw-proof.ts doctor",
    "  node --import tsx scripts/e2e/quick-replies-openclaw-proof.ts local-smoke",
    "  node --import tsx scripts/e2e/quick-replies-openclaw-proof.ts run --dry-run",
    "",
    "Options:",
    "  --output-dir <path>   Artifact directory under .artifacts/qa-e2e/quick-replies.",
    "  --dry-run             Print and write the resolved local proof plan.",
  ].join("\n");
}

function usage(): never {
  throw new Error(usageText());
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

function takeValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) usage();
  return value;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): QuickRepliesProofOptions {
  const first = argv[0];
  const command: Command = first === "doctor" || first === "local-smoke" || first === "run" ? first : "run";
  const args = command === first ? argv.slice(1) : argv;
  const seen = new Set<string>();
  const opts: QuickRepliesProofOptions = {
    command,
    dryRun: false,
    outputDir: path.join(DEFAULT_OUTPUT_ROOT, `${timestamp()}-${randomUUID().slice(0, 8)}`),
  };

  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (key === "--help" || key === "-h") {
      console.log(usageText());
      process.exit(0);
    }
    if (key === "--dry-run") {
      opts.dryRun = true;
      continue;
    }
    if (!key.startsWith("--")) usage();
    if (seen.has(key)) throw new Error(`${key} was provided more than once`);
    seen.add(key);
    const value = takeValue(args, index);
    index += 1;
    switch (key) {
      case "--output-dir":
        opts.outputDir = value;
        break;
      default:
        usage();
    }
  }
  return opts;
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = path.relative(parent, child);
  return relativePath === "" || (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function resolveProofOutputDir(outputDir: string): string {
  const resolved = path.resolve(REPO_ROOT, outputDir);
  if (!isPathInside(DEFAULT_OUTPUT_ROOT_ABS, resolved)) {
    throw new Error(`--output-dir must resolve inside ${DEFAULT_OUTPUT_ROOT}`);
  }
  return resolved;
}

export function collectDoctorChecks(deps: ProofDeps = {}): DoctorCheck[] {
  const exists = deps.exists ?? existsSync;
  return [
    { name: "node runtime", ok: true, required: true, detail: process.version },
    { name: "package manifest", ok: exists(path.join(REPO_ROOT, "package.json")), required: true },
    { name: "quick reply hook source", ok: exists(path.join(REPO_ROOT, "src", "decorator.ts")), required: true },
    { name: "proof script", ok: exists(path.join(REPO_ROOT, "scripts", "e2e", "quick-replies-openclaw-proof.ts")), required: true },
  ];
}

export function buildProofPlan(opts: QuickRepliesProofOptions): Record<string, unknown> {
  return {
    command: opts.command,
    coverage: buildCoverageMatrix(),
    outputDir: opts.outputDir,
  };
}

export function buildCoverageMatrix(): { overall: string; rows: QuickRepliesCoverageRow[] } {
  return {
    overall: "narrow_subset",
    rows: [
      {
        category: "normal assistant replies to user messages",
        coverage: "conditional",
        notes: "Locally verified when a plain text outbound payload reaches reply_payload_sending; exact installed host routing depends on OpenClaw message category.",
      },
      {
        category: "tool-result follow-up messages",
        coverage: "host_dependent",
        notes: "Plain text shapes are supported locally; decoration depends on whether the host emits reply_payload_sending for the route.",
      },
      {
        category: "proactive/cron messages",
        coverage: "host_dependent",
        notes: "Plain text shapes are supported locally; decoration depends on whether the host emits reply_payload_sending for the route.",
      },
      {
        category: "message tool sends",
        coverage: "host_dependent",
        notes: "Decoration depends on whether message-tool sends traverse reply_payload_sending.",
      },
      {
        category: "plugin-originated sends",
        coverage: "host_dependent",
        notes: "Callback replies are plugin-originated; redecorating them depends on host routing.",
      },
      {
        category: "OCA canonical status/completion messages",
        coverage: "suppressed",
        notes: "Status, reasoning, fallback, compaction, and error notices are structurally suppressed.",
      },
      {
        category: "messages that already have buttons",
        coverage: "suppressed",
        notes: "Existing presentation, interactive, channel-native buttons/components, and top-level actions/buttons suppress Quick Replies.",
      },
    ],
  };
}

function writeSummary(outputDir: string, summary: Record<string, unknown>): void {
  const resolved = resolveProofOutputDir(outputDir);
  mkdirSync(resolved, { recursive: true });
  writeFileSync(path.join(resolved, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

function labelsFromResult(result: unknown): string[] {
  if (!result || typeof result !== "object" || !("payload" in result)) return [];
  const payload = (result as { payload?: { presentation?: { blocks?: Array<{ buttons?: Array<{ label?: string }> }> } } }).payload;
  return payload?.presentation?.blocks?.[0]?.buttons?.map((button) => String(button.label)) ?? [];
}

function presentationFromResult(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("payload" in result)) return undefined;
  const payload = (result as { payload?: { presentation?: unknown } }).payload;
  return payload?.presentation;
}

export async function runLocalSmoke(opts: QuickRepliesProofOptions): Promise<Record<string, unknown>> {
  let evaluatorCalls = 0;
  const diagnostics: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const api = { pluginConfig: {}, config: {}, runtime: {} } as unknown as OpenClawPluginApi;
  const hook = createQuickReplyPayloadHook(api, {
    evaluator: {
      async evaluate(): Promise<QuickReplyEvaluationResult> {
        evaluatorCalls += 1;
        return {
          decision: {
            eligible: true,
            confidence: 0.95,
            suggestions: [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }],
          },
        };
      },
    },
    log(event, fields) {
      diagnostics.push({ event, fields });
    },
  });
  const evaluatorResult = await hook(
    { kind: "final", channel: "telegram", payload: { text: "Continue?" } } as PluginHookReplyPayloadSendingEvent,
    { messageId: "evaluator-1", runId: "proof-run" } as PluginHookReplyPayloadSendingContext,
  );
  const suppressedResult = await hook({
    kind: "final",
    channel: "telegram",
    payload: {
      text: "Proceed?",
      presentation: { blocks: [{ type: "buttons", buttons: [{ label: "Core", action: { type: "callback", value: "core:ok" } }] }] },
    },
  } as PluginHookReplyPayloadSendingEvent, {
    messageId: "suppressed-1",
    runId: "proof-run",
  } as PluginHookReplyPayloadSendingContext);

  const summary = {
    ok: Boolean(evaluatorResult && !suppressedResult),
    coverage: buildCoverageMatrix(),
    diagnostics,
    dryRun: opts.dryRun,
    evaluatorCalls,
    evaluatorLabels: labelsFromResult(evaluatorResult),
    hookCoveredTelegramPresentation: presentationFromResult(evaluatorResult),
    manualTestSurface: {
      currentSourceConversation: "host_dependent_when_no_reply_payload_sending_hook_is_seen",
      recommended: "verify_the_route_emits_reply_payload_sending_before_debugging_suggestions",
    },
    proof: "quick-replies-openclaw-local-smoke",
    suppressedExistingInteractivity: !suppressedResult,
  };
  writeSummary(opts.outputDir, summary);
  return summary;
}

export async function runProof(opts: QuickRepliesProofOptions): Promise<Record<string, unknown>> {
  if (opts.dryRun) {
    const summary = { ok: true, dryRun: true, plan: buildProofPlan(opts), proof: "quick-replies-openclaw-run" };
    writeSummary(opts.outputDir, summary);
    return summary;
  }
  throw new Error("Quick Replies proof run is plan-only. Use --dry-run or local-smoke.");
}

export function cleanupProofArtifacts(outputDir: string): void {
  const resolved = resolveProofOutputDir(outputDir);
  rmSync(resolved, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const opts = parseArgs();
  if (opts.command === "doctor") {
    const checks = collectDoctorChecks();
    const summary = { ok: checks.every((check) => !check.required || check.ok), checks };
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exit(1);
    return;
  }
  const result = opts.command === "local-smoke" ? await runLocalSmoke(opts) : await runProof(opts);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
