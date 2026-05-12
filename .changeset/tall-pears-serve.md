---
"@crup/runrate": minor
---

Replace the default terminal dashboard with a local React web dashboard served by the CLI, including automatic port fallback from the preferred port upward. Remove the legacy TUI/static table command path so the package is web-dashboard first.

This also hardens Codex parsing and pricing parity by streaming JSONL files, slimming raw records before normalization, resolving Codex model fallbacks like Codeburn, deduping cumulative token snapshots, and adding regression coverage for aliases and cumulative deltas. Claude Code remains best-effort and fixture-tested only.
