#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = dirname(dirname(scriptPath));
const PACKAGE_NAME = "openclaw-quick-replies";
const PLUGIN_NAME = "Quick Replies";
const OPENCLAW_VERSION = "2026.7.1";

export function validateReleaseMetadata({ releaseVersion, baseDir = rootDir } = {}) {
  const pkg = JSON.parse(readFileSync(join(baseDir, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(baseDir, "openclaw.plugin.json"), "utf8"));
  const changelog = readFileSync(join(baseDir, "CHANGELOG.md"), "utf8");
  const lockfile = readFileSync(join(baseDir, "pnpm-lock.yaml"), "utf8");
  const version = releaseVersion ?? pkg.version;

  assert(pkg.name === PACKAGE_NAME, `Unexpected package name: ${pkg.name}`);
  assert(manifest.name === PLUGIN_NAME, `Unexpected plugin display name: ${manifest.name}`);
  assert(pkg.version === version, `package.json version is ${pkg.version}, expected ${version}`);
  assert(manifest.version === version, `openclaw.plugin.json version is ${manifest.version}, expected ${version}`);
  assert(new RegExp(`^## ${escapeRegExp(version)}$`, "mu").test(changelog), `CHANGELOG.md has no ${version} section`);
  assert(pkg.engines?.node === ">=22.22.3", "Node engine must be >=22.22.3");
  assert(pkg.private !== true, "Package must be publishable");
  assert(pkg.openclaw?.extensions?.includes("./dist/index.js"), "Missing built OpenClaw entrypoint");
  assert(pkg.openclaw?.install?.clawhubSpec === PACKAGE_NAME, "Invalid ClawHub install spec");
  assert(pkg.openclaw?.install?.npmSpec === PACKAGE_NAME, "Invalid npm install spec");
  assert(pkg.openclaw?.install?.defaultChoice === "clawhub", "ClawHub must be the default source");
  assert(pkg.openclaw?.install?.minHostVersion === `>=${OPENCLAW_VERSION}`, "Invalid minimum host version");
  assert(pkg.openclaw?.compat?.pluginApi === `>=${OPENCLAW_VERSION}`, "Invalid plugin API compatibility");
  assert(pkg.openclaw?.compat?.minGatewayVersion === OPENCLAW_VERSION, "Invalid gateway compatibility");
  assert(pkg.openclaw?.build?.openclawVersion === OPENCLAW_VERSION, "Invalid OpenClaw build version");
  assert(pkg.openclaw?.build?.pluginSdkVersion === OPENCLAW_VERSION, "Invalid plugin SDK build version");
  assert(!("autoUpdate" in pkg.openclaw), "Custom auto-update metadata is unsupported");
  assert(lockfile.includes(`openclaw:\n        specifier: ${OPENCLAW_VERSION}`), "Lockfile is not pinned to the release SDK");
  assert(Array.isArray(pkg.files) && pkg.files.includes("docs/assets/"), "README assets are missing from the npm allowlist");

  return { packageName: pkg.name, version, openclawVersion: OPENCLAW_VERSION };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] === scriptPath) {
  try {
    const releaseVersion = process.argv.slice(2).find((arg) => arg !== "--" && !arg.startsWith("--"));
    const result = validateReleaseMetadata({ releaseVersion });
    console.log(`Release metadata validated: ${result.packageName}@${result.version} (OpenClaw ${result.openclawVersion})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
