# Contributing to Runrate

Thanks for helping improve Runrate.

Runrate is early-stage OSS. The highest-value contributions are parser correctness fixes, redacted fixtures, pricing/model aliases, adapter validation, and focused UI improvements.

## Good First Contributions

- Add redacted Codex or Claude Code fixtures for edge cases.
- Fix model aliases or bundled pricing entries.
- Add parser tests for cumulative token snapshots.
- Validate Claude Code against real local data.
- Improve README examples, screenshots, or troubleshooting notes.
- Improve session/model/provider breakdowns in the web UI.

## Local Setup

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds once, starts `tsup --watch`, serves the local dashboard, and reloads the browser when `dist/cli.js` or `dist/web/app.global.js` changes. Pass normal CLI flags after `--`:

```bash
pnpm dev -- --port 49137
pnpm dev -- --provider codex
```

Use `npm start` when you want the production-style build-and-run path.

Common checks:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm pack:check
```

Please run the relevant checks before opening a PR. For parser/pricing changes, run the full set.

## Fixtures

Provider logs can contain prompts, private file paths, repo names, API keys, and sensitive metadata.

Do not commit real raw logs. Add small redacted fixtures that preserve the fields needed for parser behavior:

- timestamps
- session ids, rewritten to harmless examples
- workspace paths, rewritten to harmless examples
- model ids
- token usage fields
- vendor cost fields, if relevant

## Parser Changes

Parser correctness matters more than chart appearance.

If a provider emits streamed snapshots or cumulative counters, normalize those records before aggregation. Tests should cover:

- model resolution
- cumulative-token dedupe
- cumulative-to-delta fallback
- cache read/write tokens
- vendor cost vs calculated cost
- session/workspace metadata

## Pull Requests

Please keep PRs focused. A parser fix, a pricing alias update, and a UI redesign should be separate PRs unless they genuinely depend on each other.

Every user-facing change should include a Changeset:

```bash
pnpm changeset
```

Docs-only changes do not need a Changeset unless they affect release notes.

## Bugs

Bug reports are welcome. The best report includes:

- Runrate version
- provider/adapter
- expected total
- actual total
- pricing mode
- a redacted fixture or enough field-level detail to reproduce

Please do not paste private prompts or full provider logs into public issues.
