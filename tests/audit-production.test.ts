import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// The audited command is intentionally plain Node.js so the security job does not need a TypeScript loader.
// @ts-expect-error The repository does not emit declarations for executable scripts.
import { auditProductionDependencies } from "../scripts/audit-production.mjs";

test("production audit excludes development and host-provided peer dependencies", () => {
  const cwd = mkdtempSync(join(tmpdir(), "quick-replies-audit-test-"));
  const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

  try {
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "fixture",
        version: "1.0.0",
        dependencies: { runtime: "1.2.3" },
        optionalDependencies: { optional: "2.0.0" },
        devDependencies: { tooling: "3.0.0" },
        peerDependencies: { host: ">=4" },
      }),
    );

    const status = auditProductionDependencies({
      cwd,
      run(command: string, args: string[], options: { cwd: string }) {
        calls.push({ command, args, cwd: options.cwd });
        if (args[0] === "install") {
          const manifest = JSON.parse(readFileSync(join(options.cwd, "package.json"), "utf8"));
          assert.deepEqual(manifest.dependencies, { runtime: "1.2.3" });
          assert.deepEqual(manifest.optionalDependencies, { optional: "2.0.0" });
          assert.equal(manifest.devDependencies, undefined);
          assert.equal(manifest.peerDependencies, undefined);
        }
        return { status: 0 } as SpawnSyncReturns<Buffer>;
      },
    });

    assert.equal(status, 0);
    assert.deepEqual(
      calls.map(({ command, args }) => [command, ...args]),
      [
        ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
        ["npm", "audit", "--omit=dev", "--audit-level=high"],
      ],
    );
    assert.equal(calls.every((call) => !readFileIfPresent(call.cwd)), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

function readFileIfPresent(path: string): boolean {
  try {
    readFileSync(join(path, "package.json"));
    return true;
  } catch {
    return false;
  }
}
