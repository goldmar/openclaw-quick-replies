# Development

## Requirements

- Node.js 22.22.3 or newer
- pnpm 10.30.0 through Corepack

## Local checks

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm proof:quick-replies:all
pnpm validate:release-metadata -- 0.1.0
pnpm audit:prod
pnpm pack:dry-run
```

`pnpm verify` runs typecheck, the production bundle, and all tests. The proof suite writes only under `.artifacts/qa-e2e/quick-replies`, and generated output is ignored.

To test the exact package artifact:

```bash
npm pack
OPENCLAW_HOME="$(mktemp -d)" openclaw plugins install npm-pack:./openclaw-quick-replies-0.1.0.tgz
```

Inspect the installed runtime and remove the temporary OpenClaw home afterward.

## Release process

1. Update `package.json`, `openclaw.plugin.json`, the lockfile, and `CHANGELOG.md` to the same version.
2. Run the complete local checks and inspect `npm pack --json` contents.
3. Merge to `main` with all required checks passing.
4. Dispatch `.github/workflows/release.yml` with the exact version and `main` commit SHA.
5. Approve the protected `release` environment.
6. Verify npm, ClawHub, and the GitHub release resolve to the same commit and artifact digest.

Publishing uses GitHub OIDC trusted publishers. Bootstrap credentials are short-lived and must be removed and revoked immediately after the first release.
