import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCoverageMatrix,
  buildProofPlan,
  cleanupProofArtifacts,
  collectDoctorChecks,
  parseArgs,
  resolveProofOutputDir,
  runLocalSmoke,
  runProof,
} from "../scripts/e2e/quick-replies-openclaw-proof";

const repoRoot = join(import.meta.dirname, "..");

describe("OpenClaw Quick Replies proof runner", () => {
  it("parses proof controls and rejects invalid arguments", () => {
    const opts = parseArgs([
      "local-smoke",
      "--dry-run",
      "--output-dir",
      ".artifacts/qa-e2e/quick-replies/test",
    ]);

    assert.equal(opts.command, "local-smoke");
    assert.equal(opts.dryRun, true);
    assert.equal(opts.outputDir, ".artifacts/qa-e2e/quick-replies/test");

    assert.throws(() => parseArgs(["--output-dir", "one", "--output-dir", "two"]), /--output-dir was provided more than once/);
    assert.throws(() => parseArgs(["--timeout-ms", "1000"]), /Usage:/);
    assert.throws(() => parseArgs(["local-smoke", "--unknown"]), /Usage:/);
  });

  it("rejects output directories outside the proof artifact root", () => {
    const outside = mkdtempSync(join(tmpdir(), "quick-replies-proof-outside-"));
    try {
      assert.throws(() => resolveProofOutputDir(outside), /--output-dir must resolve inside/);
      assert.throws(() => resolveProofOutputDir("../../tmp/quick-replies-proof"), /--output-dir must resolve inside/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("collects doctor failures without requiring live dependencies by default", () => {
    const passing = collectDoctorChecks();
    assert.ok(passing.every((check) => !check.required || check.ok));

    const failing = collectDoctorChecks({
      exists(file) {
        return !file.endsWith("decorator.ts");
      },
    });
    assert.ok(failing.some((check) => check.name === "quick reply hook source" && !check.ok && check.required));
  });

  it("builds a redacted dry-run proof plan and writes summary artifacts", async () => {
    const outputDir = join(".artifacts", "qa-e2e", "quick-replies", `dry-run-${Date.now()}`);
    try {
      const opts = parseArgs(["run", "--dry-run", "--output-dir", outputDir]);
      const plan = buildProofPlan(opts);
      assert.equal((plan.coverage as { overall: string }).overall, "narrow_subset");
      assert.equal(plan.outputDir, outputDir);

      const summary = await runProof(opts);
      assert.equal(summary.ok, true);
      assert.equal(summary.dryRun, true);
      assert.equal(existsSync(join(repoRoot, outputDir, "summary.json")), true);
    } finally {
      rmSync(join(repoRoot, outputDir), { recursive: true, force: true });
    }
  });

  it("requires dry-run for proof run planning", async () => {
    await assert.rejects(runProof(parseArgs(["run"])), /Use --dry-run or local-smoke/);
  });

  it("runs deterministic local smoke and writes a summary", async () => {
    const outputDir = join(".artifacts", "qa-e2e", "quick-replies", `local-smoke-${Date.now()}`);
    try {
      const summary = await runLocalSmoke(parseArgs(["local-smoke", "--output-dir", outputDir]));
      assert.equal(summary.ok, true);
      assert.equal((summary.coverage as { overall: string }).overall, "narrow_subset");
      assert.deepEqual(summary.evaluatorLabels, ["Yes", "No"]);
      assert.equal(summary.evaluatorCalls, 1);
      assert.equal(summary.suppressedExistingInteractivity, true);
      assert.ok(Array.isArray(summary.diagnostics));
      assert.ok((summary.diagnostics as Array<{ event: string }>).some((entry) => entry.event === "decorated"));
      assert.deepEqual(
        ((summary.hookCoveredTelegramPresentation as { blocks: Array<{ buttons: Array<{ label: string }> }> }).blocks[0].buttons).map((button) => button.label),
        ["Yes", "No"],
      );
      assert.equal((summary.manualTestSurface as { currentSourceConversation: string }).currentSourceConversation, "host_dependent_when_no_reply_payload_sending_hook_is_seen");
      const summaryPath = join(repoRoot, outputDir, "summary.json");
      assert.equal(existsSync(summaryPath), true);
      assert.match(readFileSync(summaryPath, "utf8"), /quick-replies-openclaw-local-smoke/);
    } finally {
      rmSync(join(repoRoot, outputDir), { recursive: true, force: true });
    }
  });

  it("keeps local smoke behavior independent from proof dry-run planning", async () => {
    const outputDir = join(".artifacts", "qa-e2e", "quick-replies", `local-smoke-dry-${Date.now()}`);
    try {
      const summary = await runLocalSmoke(parseArgs(["local-smoke", "--dry-run", "--output-dir", outputDir]));
      assert.equal(summary.ok, true);
      assert.deepEqual(summary.evaluatorLabels, ["Yes", "No"]);
      assert.equal(summary.evaluatorCalls, 1);
      assert.equal(existsSync(join(repoRoot, outputDir, "summary.json")), true);
    } finally {
      rmSync(join(repoRoot, outputDir), { recursive: true, force: true });
    }
  });

  it("cleans only guarded proof artifact paths", () => {
    const outputDir = join(".artifacts", "qa-e2e", "quick-replies", `cleanup-${Date.now()}`);
    const artifactDir = join(repoRoot, outputDir);
    const outside = mkdtempSync(join(tmpdir(), "quick-replies-proof-keep-"));
    try {
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(join(artifactDir, "summary.json"), "{}");
      mkdirSync(join(outside, "public-artifacts"), { recursive: true });
      writeFileSync(join(outside, "public-artifacts", "keep.txt"), "keep");

      cleanupProofArtifacts(outputDir);
      assert.equal(existsSync(artifactDir), false);
      assert.throws(() => cleanupProofArtifacts(outside), /--output-dir must resolve inside/);
      assert.equal(readFileSync(join(outside, "public-artifacts", "keep.txt"), "utf8"), "keep");
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("documents locally verified coverage by OpenClaw message category", () => {
    const matrix = buildCoverageMatrix();
    const rows = Object.fromEntries(matrix.rows.map((row) => [row.category, row.coverage]));

    assert.equal(matrix.overall, "narrow_subset");
    assert.equal(rows["normal assistant replies to user messages"], "conditional");
    assert.equal(rows["tool-result follow-up messages"], "host_dependent");
    assert.equal(rows["proactive/cron messages"], "host_dependent");
    assert.equal(rows["message tool sends"], "host_dependent");
    assert.equal(rows["plugin-originated sends"], "host_dependent");
    assert.equal(rows["OCA canonical status/completion messages"], "suppressed");
    assert.equal(rows["messages that already have buttons"], "suppressed");
  });
});
