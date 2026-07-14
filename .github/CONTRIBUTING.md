# Contributing

Thanks for helping improve OpenClaw Quick Replies.

Before opening a pull request, search existing issues and keep changes focused on conservative Telegram quick replies. Discord support requires a public OpenClaw generic inbound-submission contract; platform-specific workarounds are out of scope.

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm proof:quick-replies:all
```

Package, manifest, dependency, or release changes must also pass `pnpm release:check`.

Add tests for behavior changes. Pull requests should explain the user-visible result, security or privacy impact, and validation performed. Do not include credentials, private conversation data, generated artifacts, local machine paths, or registry tokens.

By participating, you agree to follow [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md). Security reports belong in GitHub private vulnerability reporting, as described in [SECURITY.md](../SECURITY.md).
