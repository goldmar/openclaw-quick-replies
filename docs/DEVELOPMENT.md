# Development

## Requirements

- Node.js 22.22.3 or newer
- pnpm 10.30.0 through Corepack

## Local checks

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm benchmark:evaluator-overhead
pnpm proof:quick-replies:all
pnpm validate:release-metadata -- "$(node -p "require('./package.json').version")"
pnpm audit:prod
pnpm pack:dry-run
```

`pnpm verify` runs typecheck, the production bundle, and all tests. The proof suite writes only under `.artifacts/qa-e2e/quick-replies`, and generated output is ignored.

`pnpm benchmark:evaluator-overhead` reports plugin-side hook dispatch and validation latency with an immediate evaluator stub. It is credential-free and intentionally excludes provider/model latency; use the structured runtime evaluator diagnostics for end-to-end measurements in a configured installation.

To test the exact package artifact:

```bash
tarball="$(npm pack --json | node -e 'let data=""; process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(data)[0].filename))')"
OPENCLAW_HOME="$(mktemp -d)" openclaw plugins install "npm-pack:./$tarball"
```

Inspect the installed runtime and remove the temporary OpenClaw home afterward.

## Release process

1. Update `package.json`, `openclaw.plugin.json`, the lockfile, and `CHANGELOG.md` to the same version.
2. Run the complete local checks and inspect `npm pack --json` contents.
3. Merge to `main` with all required checks passing.
4. Dispatch `.github/workflows/release.yml` with the exact version and `main` commit SHA.
5. Approve the protected `release` environment.
6. Verify npm, ClawHub, and the GitHub release resolve to the same commit and artifact digest.

Publishing uses GitHub OIDC trusted publishers. Publishing tokens must not be stored in the repository.
