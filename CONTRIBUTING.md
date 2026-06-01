# Contributing to ORGII

Thank you for helping improve ORGII. This project is a Tauri v2 desktop app built with React, TypeScript, webpack, and Rust.

## Code of conduct

Be respectful, constructive, and specific. Assume good intent, but do not tolerate harassment, discrimination, or personal attacks. Keep issue and pull request discussions focused on the work.

## Before you start

- Search existing issues and pull requests before opening a new one.
- For larger changes, open an issue or discussion first so maintainers can confirm the direction.
- Keep pull requests small and focused. One fix or feature per PR is easiest to review.
- Do not include secrets, private credentials, proprietary data, generated artifacts, or unrelated formatting changes.

## Development setup

Prerequisites:

- Node.js 20 or current LTS
- Rust toolchain compatible with `src-tauri/Cargo.toml`
- Tauri platform prerequisites for your OS
- Python 3 if you need optional asset download scripts

From the repository root:

```bash
npm install
```

Copy `.env.example` to `.env` only when you need local configuration. `.env` is gitignored; never commit real secrets.

Run the full desktop app:

```bash
npm run tauri:dev
```

Tauri starts the webpack dev server through its `beforeDevCommand`; contributors should use the Tauri scripts rather than launching the frontend shell independently.

## Useful checks

Run the checks that match the files you changed before opening a PR.

Frontend:

```bash
npm run lint
npm run test
npm run check:circular
```

Rust/Tauri:

```bash
npm run cargo:check
npm run cargo:clippy
npm run cargo:test
```

Targeted Rust module tests are available, for example:

```bash
npm run cargo:test:agent_core
npm run cargo:test:event_store
npm run cargo:test:work_station
```

Core UI end-to-end tests live in `tests/e2e` and use WebDriverIO with `tauri-webdriver-automation`. Run them after UI changes that can affect chat or session behavior:

```bash
cargo install tauri-webdriver-automation --locked
cd tests/e2e
npm install
npm test
```

See `tests/e2e/README.md` for account setup, isolated service runs, targeted specs, and scenario filters.

If a check cannot be run locally, explain why in the pull request and include any partial verification you performed.

## Project structure

- `src/` — React, TypeScript, UI, stores, hooks, and frontend services
- `src-tauri/` — Tauri shell and Rust backend
- `Documentation/` — living architecture and feature documentation
- `scripts/` — development, setup, maintenance, and build scripts
- `tests/` — repository-level tests and test helpers

Documentation is organized by domain under `Documentation/`. New or substantially changed features should include documentation when the behavior, architecture, or operating model is not obvious from the code. Follow `Documentation/_TEMPLATE.md` and the naming format documented in `Documentation/README.md`.

## Coding guidelines

Follow the repository rule files in `.cursor/rules/`, especially:

- `.cursor/rules/orgii-frontend.mdc` for frontend architecture, React, TypeScript, styling, state, i18n, and UI conventions.
- `.cursor/rules/frontend-backend-alignment.mdc` for contracts between TypeScript and Tauri/Rust.
- `.cursor/rules/rust-resource-lifecycle.mdc` and `.cursor/rules/cargo-cleanup.mdc` for Rust backend work.
- The focused MDC files for terminology, tooltips, session rendering, and layout debugging when touching those areas.

In general, keep changes focused, use existing shared components and tokens, prefer typed values over hardcoded domain strings, propagate errors instead of silently swallowing them, update all supported locales for user-facing text, and remove dead code immediately.

## Tests

Add or update tests when changing behavior. Prefer focused tests that cover the changed module or component. For bug fixes, include a regression test when practical.

## Pull request checklist

Before requesting review, confirm that:

- The PR has a clear title and description.
- The change is scoped to one issue, feature, or fix.
- Relevant lint, test, and cargo commands pass or are documented as not run.
- UI changes include screenshots or screen recordings when useful.
- New UI text has translations for all supported locales.
- Documentation was added or updated when the change affects architecture, setup, or user-visible behavior.
- No secrets, local configuration, generated build output, or unrelated files are included.

## Security

Do not report security vulnerabilities in public issues. Use the repository's private security advisory flow when available, or contact the maintainers privately.

Never commit API keys, signing keys, OAuth secrets, personal tokens, private logs, or user data. If you accidentally expose a secret, revoke it immediately and notify maintainers.

## License

By contributing, you agree that your contributions are licensed under the repository license: AGPL-3.0-or-later. See `LICENSE` for the full license text.
