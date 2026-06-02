---
name: setup-repo
description: Analyse the current repository type (Node/Rust/Python/Go/Tauri/etc.), install dependencies, configure .env, and run any setup scripts. Use when the user says "setup repo", "setup this project", "initialize the project", "install deps", "帮我 setup 这个 repo", or "初始化项目".
---

# Setting Up a Repository

This skill guides the agent through a complete repo setup: detect language/toolchain, install dependencies, create or populate `.env`, and run any project-specific bootstrap scripts.

## Before You Begin

1. **Confirm working directory** — ensure the shell cwd is the project root, or ask the user to confirm.
2. **Check for a `setup_repo` tool** — if your tool list includes `setup_repo`, prefer it. It wraps the steps below into a single atomic call.
3. If no dedicated tool is available, follow the Manual Setup steps.

## Quick Path — `setup_repo` Tool

If `setup_repo` is in your tool list:

```json
{
  "tool": "setup_repo",
  "path": "<absolute-or-relative-project-root>"
}
```

Report what the tool did (deps installed, `.env` created, scripts run) and surface any errors. Done.

## Manual Setup

### Step 1 — Detect Project Type

```
list_dir <project_root>
```

Look for these marker files to identify the toolchain(s):

| File(s)                                            | Toolchain                |
| -------------------------------------------------- | ------------------------ |
| `package.json`                                     | Node / npm / yarn / pnpm |
| `Cargo.toml`                                       | Rust / Cargo             |
| `Cargo.toml` + `tauri.conf.json`                   | Tauri (Rust + Node)      |
| `pyproject.toml` / `requirements.txt` / `setup.py` | Python                   |
| `go.mod`                                           | Go                       |
| `Gemfile`                                          | Ruby                     |
| `build.gradle` / `pom.xml`                         | Java / Kotlin / Maven    |

A project may have multiple toolchains (e.g. Tauri = Rust + Node frontend). Set up **all** detected toolchains.

### Step 2 — Read Setup Instructions

Before running anything, read these files if they exist:

- `README.md` — look for "Getting Started", "Development", or "Setup" sections
- `CONTRIBUTING.md` — may contain required steps or environment variables
- `.env.example` / `.env.sample` / `.env.template` — the canonical `.env` template

```
read_file README.md
read_file .env.example   # if present
```

### Step 3 — Configure `.env`

If `.env.example` (or similar) exists and `.env` does not:

1. Copy the template: `cp .env.example .env`
2. Scan for `REQUIRED` or non-empty placeholder values (e.g. `API_KEY=YOUR_KEY_HERE`).
3. Ask the user to fill in any secrets you cannot infer.
4. Do **not** commit `.env` — verify it is listed in `.gitignore`.

### Step 4 — Install Dependencies

Run the appropriate install command for each detected toolchain:

| Toolchain | Command                           |
| --------- | --------------------------------- |
| npm       | `npm install`                     |
| yarn      | `yarn install`                    |
| pnpm      | `pnpm install`                    |
| Cargo     | `cargo fetch` (or `cargo build`)  |
| pip       | `pip install -r requirements.txt` |
| uv        | `uv sync`                         |
| poetry    | `poetry install`                  |
| Go        | `go mod download`                 |
| Ruby      | `bundle install`                  |

Detect the package manager preference:

- Presence of `pnpm-lock.yaml` → pnpm
- Presence of `yarn.lock` → yarn
- Presence of `package-lock.json` → npm

Run via `run_shell`:

```json
{ "command": "pnpm install", "cwd": "<project_root>" }
```

Capture and surface any errors. If a build step is required after install (e.g. `cargo build` for Tauri), run it.

### Step 5 — Run Setup Scripts

Check `package.json` for lifecycle scripts and run them if documented:

| Script name   | Purpose                                 |
| ------------- | --------------------------------------- |
| `prepare`     | Runs automatically after install        |
| `setup`       | Explicit project setup script           |
| `postinstall` | Runs automatically after npm install    |
| `db:migrate`  | Database migration                      |
| `codegen`     | Code generation (GraphQL, Prisma, etc.) |

For non-Node projects, look for `Makefile` targets like `make setup`, `make init`, or `make bootstrap`.

### Step 6 — Verify

After setup, do a quick smoke-check:

- Node: `node --version && npm ls --depth=0 2>&1 | head -20`
- Rust: `cargo check 2>&1 | tail -10`
- Python: `python -c "import <main_package>" 2>&1`
- Go: `go build ./...`

Report the result to the user.

## Tauri Projects

Tauri projects require **both** Node and Rust setup:

1. Install Node deps first: `pnpm install` (or yarn/npm)
2. Then Rust: `cargo fetch --manifest-path src-tauri/Cargo.toml`
3. Optional smoke-check: `cargo check --manifest-path src-tauri/Cargo.toml`

## Checklist

- [ ] Working directory confirmed as project root
- [ ] All toolchains detected
- [ ] README.md and `.env.example` read before running commands
- [ ] `.env` created from template; user prompted for any required secrets
- [ ] All dependency install commands succeeded (or errors surfaced)
- [ ] Setup scripts run if documented
- [ ] Smoke-check passed and result reported to user
