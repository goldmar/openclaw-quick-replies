import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { OpenClawPluginService, OpenClawPluginServiceContext } from "openclaw/plugin-sdk/plugin-entry";

const execFileAsync = promisify(execFile);
export const UPDATE_CALLBACK_NAMESPACE = "oqru";
export const PACKAGE_NAME = "openclaw-quick-replies";
export const NPM_PACKAGE_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`;
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60_000;
export const UPDATE_PROMPT_INTERVAL_MS = 7 * UPDATE_CHECK_INTERVAL_MS;
export const UPDATE_APPROVAL_TTL_MS = UPDATE_PROMPT_INTERVAL_MS;
export const UPDATE_RESTART_APPROVAL_TTL_MS = 60 * 60_000;
export const UPDATE_FETCH_TIMEOUT_MS = 10_000;
const UPDATE_STATE_FILE = join("plugins", PACKAGE_NAME, "update-state.json");

type UpdateState = {
  lastCheckedAt?: string;
  latestVersion?: string;
  promptedVersion?: string;
  lastPromptedAt?: string;
  updateInstalledVersion?: string;
  restartPromptedVersion?: string;
  restartPromptedAt?: string;
  lastError?: string;
};

type CommandResult = { stdout: string; stderr: string };
type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
type ReleaseFetcher = () => Promise<string | undefined>;

export type UpdateCheckerOptions = {
  currentVersion?: string;
  enabled: () => boolean;
  fetchLatestVersion?: ReleaseFetcher;
  runCommand?: CommandRunner;
  now?: () => number;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

function normalizeStableVersion(version: string | undefined): string | undefined {
  const normalized = version?.trim().replace(/^v/iu, "");
  if (!normalized || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(normalized)) {
    return undefined;
  }
  return normalized.split(".").every((part) => Number.isSafeInteger(Number(part))) ? normalized : undefined;
}

function stableVersionParts(version: string | undefined): [number, number, number] | undefined {
  const normalized = normalizeStableVersion(version);
  if (!normalized) return undefined;
  const parts = normalized.split(".").map(Number);
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function isNewerStableVersion(candidate: string | undefined, current: string | undefined): boolean {
  const next = stableVersionParts(candidate);
  const base = stableVersionParts(current);
  if (!next || !base) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index]! > base[index]!) return true;
    if (next[index]! < base[index]!) return false;
  }
  return false;
}

export function buildUpdateCallbackData(action: "install" | "restart", version: string): string | null {
  const normalized = normalizeStableVersion(version);
  return normalized ? `${UPDATE_CALLBACK_NAMESPACE}:v1:${action}:${normalized}` : null;
}

export function parseUpdateCallbackData(raw: unknown): { action: "install" | "restart"; version: string } | null {
  if (typeof raw !== "string") return null;
  const match = /^oqru:v1:(install|restart):(\d+\.\d+\.\d+)$/u.exec(raw);
  if (!match?.[1] || !match[2] || buildUpdateCallbackData(match[1] as "install" | "restart", match[2]) !== raw) {
    return null;
  }
  return { action: match[1] as "install" | "restart", version: match[2] };
}

async function fetchNpmLatestVersion(): Promise<string | undefined> {
  const response = await fetch(NPM_PACKAGE_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(UPDATE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  return normalizeStableVersion((payload as Record<string, unknown>).version as string | undefined);
}

async function runOpenClawCommand(command: string, args: string[]): Promise<CommandResult> {
  const result = await execFileAsync(command, args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
  return { stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "" };
}

export class QuickRepliesUpdateChecker {
  private readonly currentVersion: string | undefined;
  private readonly fetchLatestVersion: ReleaseFetcher;
  private readonly runCommand: CommandRunner;
  private readonly now: () => number;
  private readonly installInFlight = new Map<string, Promise<void>>();
  private statePath: string | undefined;
  private checkInFlight: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: UpdateCheckerOptions) {
    this.currentVersion = normalizeStableVersion(options.currentVersion);
    this.fetchLatestVersion = options.fetchLatestVersion ?? fetchNpmLatestVersion;
    this.runCommand = options.runCommand ?? runOpenClawCommand;
    this.now = options.now ?? Date.now;
  }

  createService(): OpenClawPluginService {
    return {
      id: `${PACKAGE_NAME}-update-checker`,
      start: (ctx) => this.start(ctx),
      stop: () => this.stop(),
    };
  }

  start(ctx: OpenClawPluginServiceContext): void {
    this.stop();
    this.statePath = join(ctx.stateDir, UPDATE_STATE_FILE);
    this.maybeCheck();
    this.timer = setInterval(() => this.maybeCheck(), UPDATE_CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  maybeCheck(): void {
    if (!this.options.enabled() || !this.currentVersion || !this.statePath || this.checkInFlight) return;
    const state = this.readState();
    const lastCheckedAt = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : Number.NaN;
    if (Number.isFinite(lastCheckedAt) && this.now() - lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) return;

    this.checkInFlight = this.checkForUpdate()
      .catch((error) => this.options.log?.("update_check_failed", { error: errorMessage(error) }))
      .finally(() => { this.checkInFlight = undefined; });
  }

  async waitForIdle(): Promise<void> {
    await this.checkInFlight;
  }

  claimPromptVersion(): string | undefined {
    if (!this.options.enabled() || !this.currentVersion || !this.statePath) return undefined;
    try {
      const state = this.readState();
      const latestVersion = normalizeStableVersion(state.latestVersion);
      if (!isNewerStableVersion(latestVersion, this.currentVersion)) return undefined;
      if (state.updateInstalledVersion === latestVersion) return undefined;

      const promptedAt = state.promptedVersion === latestVersion && state.lastPromptedAt
        ? Date.parse(state.lastPromptedAt)
        : Number.NaN;
      if (Number.isFinite(promptedAt) && this.now() - promptedAt < UPDATE_PROMPT_INTERVAL_MS) return undefined;

      this.writeState({
        ...state,
        promptedVersion: latestVersion,
        lastPromptedAt: new Date(this.now()).toISOString(),
      });
      return latestVersion;
    } catch (error) {
      this.options.log?.("update_prompt_failed", { error: errorMessage(error) });
      return undefined;
    }
  }

  canInstall(version: string): boolean {
    if (!this.options.enabled()) return false;
    const normalized = normalizeStableVersion(version);
    if (!normalized || !this.currentVersion || !isNewerStableVersion(normalized, this.currentVersion)) return false;
    const state = this.readState();
    if (state.promptedVersion !== normalized || state.updateInstalledVersion === normalized) return false;
    const promptedAt = state.lastPromptedAt ? Date.parse(state.lastPromptedAt) : Number.NaN;
    return Number.isFinite(promptedAt) && this.now() - promptedAt <= UPDATE_APPROVAL_TTL_MS;
  }

  async install(version: string): Promise<void> {
    const normalized = normalizeStableVersion(version);
    if (!normalized || !this.canInstall(normalized)) throw new Error("Update approval is missing, expired, or invalid.");
    const existing = this.installInFlight.get(normalized);
    if (existing) return existing;

    const install = this.resolveInstallCommand(normalized)
      .then((args) => this.runCommand("openclaw", args))
      .then(() => {
        this.writeState({
          ...this.readState(),
          updateInstalledVersion: normalized,
          restartPromptedVersion: normalized,
          restartPromptedAt: new Date(this.now()).toISOString(),
        });
      })
      .finally(() => this.installInFlight.delete(normalized));
    this.installInFlight.set(normalized, install);
    return install;
  }

  canRestart(version: string): boolean {
    if (!this.options.enabled()) return false;
    const normalized = normalizeStableVersion(version);
    if (!normalized) return false;
    const state = this.readState();
    if (state.updateInstalledVersion !== normalized || state.restartPromptedVersion !== normalized) return false;
    const promptedAt = state.restartPromptedAt ? Date.parse(state.restartPromptedAt) : Number.NaN;
    const age = this.now() - promptedAt;
    return Number.isFinite(promptedAt) && age >= 0 && age <= UPDATE_RESTART_APPROVAL_TTL_MS;
  }

  async restart(version: string): Promise<void> {
    const normalized = normalizeStableVersion(version);
    if (!normalized || !this.canRestart(normalized)) throw new Error("Restart approval is missing, expired, or invalid.");
    const state = this.readState();
    delete state.restartPromptedVersion;
    delete state.restartPromptedAt;
    this.writeState(state);
    await this.runCommand("openclaw", ["gateway", "restart"]);
  }

  private async checkForUpdate(): Promise<void> {
    const checkedAt = new Date(this.now()).toISOString();
    try {
      const latestVersion = normalizeStableVersion(await this.fetchLatestVersion());
      const next = { ...this.readState(), lastCheckedAt: checkedAt, latestVersion };
      delete next.lastError;
      this.writeState(next);
      this.options.log?.("update_check_completed", { latestVersion: latestVersion ?? null });
    } catch (error) {
      this.writeState({ ...this.readState(), lastCheckedAt: checkedAt, lastError: errorMessage(error) });
      throw error;
    }
  }

  private async resolveInstallCommand(version: string): Promise<string[]> {
    const inspection = await this.runCommand("openclaw", ["plugins", "inspect", PACKAGE_NAME, "--json"]);
    const source = parseInstalledSource(inspection.stdout);
    if (source === "npm") {
      return ["plugins", "update", `${PACKAGE_NAME}@${version}`];
    }
    if (source === "clawhub") {
      // OpenClaw 2026.7.1 supports exact npm overrides in `plugins update`,
      // while exact ClawHub versions use the documented force-reinstall path.
      return ["plugins", "install", `clawhub:${PACKAGE_NAME}@${version}`, "--force"];
    }
    throw new Error("The installed Quick Replies source cannot be updated automatically.");
  }

  private readState(): UpdateState {
    if (!this.statePath) return {};
    try {
      const raw = JSON.parse(readFileSync(this.statePath, "utf8")) as unknown;
      return normalizeState(raw);
    } catch {
      return {};
    }
  }

  private writeState(state: UpdateState): void {
    if (!this.statePath) return;
    mkdirSync(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, "utf8");
    renameSync(temporaryPath, this.statePath);
  }
}

function normalizeState(raw: unknown): UpdateState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const state: UpdateState = {};
  for (const key of ["latestVersion", "promptedVersion", "updateInstalledVersion", "restartPromptedVersion"] as const) {
    const value = (raw as Record<string, unknown>)[key];
    const version = typeof value === "string" ? normalizeStableVersion(value) : undefined;
    if (version) state[key] = version;
  }
  for (const key of [
    "lastCheckedAt",
    "lastPromptedAt",
    "restartPromptedAt",
  ] as const) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value))) state[key] = value;
  }
  const lastError = (raw as Record<string, unknown>).lastError;
  if (typeof lastError === "string" && lastError.trim()) state.lastError = lastError.trim().slice(0, 500);
  return state;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseInstalledSource(raw: string): "npm" | "clawhub" | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const install = (parsed as Record<string, unknown>).install;
    if (!install || typeof install !== "object" || Array.isArray(install)) return undefined;
    const source = (install as Record<string, unknown>).source;
    return source === "npm" || source === "clawhub" ? source : undefined;
  } catch {
    return undefined;
  }
}

export function setUpdateCheckerStateDirForTests(checker: QuickRepliesUpdateChecker, stateDir: string): void {
  checker.start({ stateDir, config: {}, logger: { info() {}, warn() {}, error() {}, debug() {} } } as unknown as OpenClawPluginServiceContext);
  checker.stop();
}
