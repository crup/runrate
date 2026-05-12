# Security Policy

Runrate is local-first and reads local provider artifacts. Those artifacts may contain sensitive prompts, file paths, repo names, session metadata, or other private data.

## Reporting Security Issues

Please do not open a public issue for security-sensitive reports.

Email: connect@rajender.pro

Include:

- affected version or commit
- operating system
- provider/adapter involved
- impact
- minimal reproduction steps

Do not include private prompts, secrets, API keys, or full raw provider logs unless explicitly requested over a private channel.

## Supported Versions

Runrate is pre-1.0. Security fixes target the latest released version and `main`.

## Data Handling

By default, Runrate:

- reads local usage artifacts
- serves a local dashboard
- does not proxy model traffic
- does not upload usage data
- does not require a hosted account

Users and contributors are responsible for redacting fixtures before sharing them publicly.
