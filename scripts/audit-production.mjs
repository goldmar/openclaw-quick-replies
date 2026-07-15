#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function createProductionManifest(manifest) {
  return {
    name: manifest.name,
    version: manifest.version,
    private: true,
    dependencies: manifest.dependencies,
    optionalDependencies: manifest.optionalDependencies,
  };
}

export function auditProductionDependencies({ cwd = process.cwd(), run = spawnSync } = {}) {
  const auditDirectory = mkdtempSync(join(tmpdir(), "openclaw-quick-replies-audit-"));

  try {
    const manifest = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
    writeFileSync(
      join(auditDirectory, "package.json"),
      `${JSON.stringify(createProductionManifest(manifest), null, 2)}\n`,
    );

    const install = run(
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: auditDirectory, stdio: "inherit" },
    );
    if (install.status !== 0) {
      return install.status ?? 1;
    }

    const audit = run("npm", ["audit", "--omit=dev", "--audit-level=high"], {
      cwd: auditDirectory,
      stdio: "inherit",
    });
    return audit.status ?? 1;
  } finally {
    rmSync(auditDirectory, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exitCode = auditProductionDependencies();
}
