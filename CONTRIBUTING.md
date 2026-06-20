# Contributing to ORGII

Thank you for helping improve ORGII. This project is a Tauri v2 desktop app built with React, TypeScript, webpack, and Rust.

## Code of conduct

Be respectful, constructive, and specific. Assume good intent, but do not tolerate harassment, discrimination, or personal attacks. Keep issue and pull request discussions focused on the work.

## Before you start

- Search existing issues and pull requests before opening a new one.
- For larger changes, open an issue or discussion first so maintainers can confirm the direction.
- Keep pull requests small and focused. One fix or feature per PR is easiest to review.
- Do not include secrets, private credentials, proprietary data, generated artifacts, or unrelated formatting changes.
- If you use AI assistance, make sure a human actively participates in the design and implementation process and reviews the contribution before submission.

## Development setup

Prerequisites:

| Tool                                 | Required version       | Install                                                                                    |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------ |
| [Node.js](https://nodejs.org/)       | 20 or current LTS      | `nvm install --lts` or download from nodejs.org                                            |
| [pnpm](https://pnpm.io/installation) | 9.15                   | `npm install -g pnpm@9.15`                                                                 |
| [Rust toolchain](https://rustup.rs/) | 1.85.0 or later (MSRV) | `rustup toolchain install stable`                                                          |
| Tauri system dependencies            | —                      | Follow the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) for your OS |
| [Python 3](https://www.python.org/)  | any 3.x                | Only needed for optional asset download scripts                                            |

From the repository root:

```bash
pnpm install
```

Copy `.env.example` to `.env` only when you need local configuration. `.env` is gitignored; never commit real secrets.

Run the full desktop app:

```bash
pnpm run tauri:dev
```

Tauri starts the webpack dev server through its `beforeDevCommand`; contributors should use the Tauri scripts rather than launching the frontend shell independently.

For fast desktop iteration against a built app bundle, use:

```bash
pnpm run tauri:build:fast
```

This is the fast iteration mode for validating local Tauri changes outside the dev server: it cleans only the app target for the local development profile, rebuilds the app bundle, and opens it immediately.

## Useful checks

Run the checks that match the files you changed before opening a PR.

Frontend:

```bash
pnpm run lint
pnpm run test
pnpm run check:circular
```

Rust/Tauri:

```bash
pnpm run cargo:check
pnpm run cargo:clippy
pnpm run cargo:test
```

Targeted Rust module tests are available, for example:

```bash
pnpm run cargo:test:agent_core
pnpm run cargo:test:event_store
pnpm run cargo:test:work_station
```

Core UI end-to-end tests live in `tests/e2e` and use WebDriverIO with `tauri-webdriver-automation`. Run them after UI changes that can affect chat or session behavior:

```bash
cargo install tauri-webdriver-automation --locked
cd tests/e2e
pnpm install
pnpm test
```

See `tests/e2e/README.md` for account setup, isolated service runs, targeted specs, and scenario filters.

If a check cannot be run locally, explain why in the pull request and include any partial verification you performed.

## Project structure

- `src/` — React, TypeScript, UI, stores, hooks, and frontend services
- `src-tauri/` — Tauri shell and Rust backend
- `docs/` — living architecture and feature documentation
- `scripts/` — development, setup, maintenance, and build scripts
- `tests/` — repository-level tests and test helpers

Documentation is organized by domain under `docs/`. New or substantially changed features should include documentation when the behavior, architecture, or operating model is not obvious from the code. Use lowercase domain folders such as `docs/architecture/`, `docs/shared/`, `docs/workstation/`, and `docs/contributing/`; use `{subject}--MMDD.md` for date-stamped domain docs.

## Coding guidelines

Follow the repository rule files in `.cursor/rules/`, especially:

- `.cursor/rules/orgii-frontend.mdc` for frontend architecture, React, TypeScript, styling, state, i18n, and UI conventions.
- `.cursor/rules/frontend-backend-alignment.mdc` for contracts between TypeScript and Tauri/Rust.
- `.cursor/rules/rust-resource-lifecycle.mdc` and `.cursor/rules/cargo-cleanup.mdc` for Rust backend work.
- The focused MDC files for terminology, tooltips, session rendering, and layout debugging when touching those areas.

In general, keep changes focused, use existing shared components and tokens, prefer typed values over hardcoded domain strings, propagate errors instead of silently swallowing them, update all supported locales for user-facing text, and remove dead code immediately.

## Tests

Add or update tests when changing behavior. Prefer focused tests that cover the changed module or component. For bug fixes, include a regression test when practical.

## Commit and pull request format

Commit messages and pull request titles must use scoped Conventional Commits:

```text
feat(scope): short imperative summary
fix(scope): short imperative summary
```

Use the type that best matches the change. Common types include `feat`, `fix`, `chore`, `docs`, `style`, `test`, `refactor`, `perf`, `build`, `ci`, and `revert`. The scope should be lowercase kebab-case and should name the affected area, such as `git`, `settings`, `workstation`, `slash-menu`, or `contributing`.

Every commit must include a proper message body unless the change is truly trivial. The body should explain why the change exists, summarize the important behavior or architecture changes, and mention notable verification or migration details. Do not leave commits with only a subject line or only automated hook metadata.

The pre-commit hook appends a tamper-evidence trailer of the form
`Pre-commit hook ran. Total eslint: N, total circular: N` to every commit
it processes. The trailer is intentional: commits without it were created
with `--no-verify`, `HUSKY=0`, or another bypass, and reviewers should
treat such commits with extra scrutiny. Do not strip the trailer when
amending or rewording.

Examples:

```text
feat(git): add remote authentication prompt

Add an inline authentication prompt for remote operations so push and
pull failures can recover without sending users to a terminal. The
prompt accepts temporary tokens or stores them through the Git helper
when the user opts in.

fix(settings): preserve Git fetch preference

Keep the fetch preference in the Git integration settings instead of
resetting it when other network settings are edited. This avoids losing
the user's chosen sync behavior when unrelated fields change.

chore(contributing): document commit format

Clarify that commits need a scoped Conventional Commit subject and a
body that explains intent, not just automated hook metadata.
```

A `commit-msg` git hook runs [commitlint](https://commitlint.js.org/) with `@commitlint/config-conventional` and the project's `commitlint.config.cjs` on every commit. The hook rejects subjects that are missing a type, exceed 72 characters, end with a period, use uppercase types or scopes, or otherwise fail the rules. Fix the message and commit again rather than bypassing the hook.

Pull request descriptions must include a clear summary and a test plan. If checks were not run, explain why and list any partial verification performed.

Do not skip pre-commit, pre-push, lint-staged, or other repository hooks. Do not use `--no-verify`, `HUSKY=0`, or equivalent bypasses unless a maintainer explicitly asks you to do so for an emergency recovery task. If a hook fails, fix the underlying issue and rerun the command normally.

If you use a coding agent, the agent must read and follow this section before creating commits or pull requests. Agent-generated commits and PRs must use the same format, run the same checks, and must not bypass hooks.

## Contributor License Agreement

ORGII requires contributors to sign the repository Contributor License Agreement before a pull request can be merged. The agreement text is in [`docs/contributing/CLA.md`](docs/contributing/CLA.md).

The repository uses GitHub CLA Assistant to collect signatures and report CLA status on pull requests. When you open your first PR, CLA Assistant will comment with a signing link if your GitHub account has not signed the current agreement.

Choose the signing path that matches your contribution:

- **Individual contributor:** sign as yourself when the contribution is your own work and you are legally allowed to submit it.
- **Corporate contributor:** sign on behalf of your employer or organization only if you are authorized to bind that entity to the CLA. If you are not authorized, sign only as an individual and submit only work you are permitted to contribute individually.

Maintainers will not merge PRs until the CLA check passes. Corporate signatures may require additional maintainer review if the signing authority is unclear.

## Pull request checklist

Before requesting review, confirm that:

- The PR has a clear title and description.
- The change is scoped to one issue, feature, or fix.
- The CLA Assistant check passes, or you have asked maintainers for help resolving the signature status.
- Relevant lint, test, and cargo commands pass or are documented as not run.
- UI changes include screenshots or screen recordings when useful.
- New UI text has translations for all supported locales.
- Documentation was added or updated when the change affects architecture, setup, or user-visible behavior.
- No secrets, local configuration, generated build output, or unrelated files are included.

## Security

Do not report security vulnerabilities in public issues. Use the repository's private security advisory flow when available, or contact the maintainers privately.

Never commit API keys, signing keys, OAuth secrets, personal tokens, private logs, or user data. If you accidentally expose a secret, revoke it immediately and notify maintainers.

## License

By contributing, you agree that your contributions are licensed under the repository license: AGPL-3.0-or-later and are submitted under the Contributor License Agreement in `docs/contributing/CLA.md`. See `LICENSE` for the full license text.
