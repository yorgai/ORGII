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

1. Install deps, configure `.env`, run setup scripts (see Manual Setup below).
2. Start the app.
3. Call `setup_repo` with `action: "launch_app"` so WorkStation opens it automatically:

```json
{
  "tool": "setup_repo",
  "action": "launch_app",
  "url": "http://localhost:<port>",
  "app_type": "web",
  "command": "<launch command>"
}
```

Report what was done and surface any errors.

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

1. Read the template to identify every key the user needs to provide.
2. Classify each key:
   - **Non-secret** (e.g. `PORT=3000`, `NODE_ENV=development`, `LOG_LEVEL=info`): inferable defaults or values you can ask about in chat.
   - **Secret** (e.g. `*_API_KEY`, `*_SECRET`, `*_TOKEN`, `DATABASE_URL` with embedded password, `STRIPE_*`, `OPENAI_*`, anything obviously credential-shaped): MUST be captured via the secure flow below.
3. For every secret key, call `manage_secrets { action: "request", label: "<EXACT_ENV_VAR_NAME>", kind: "api_key" | "password" | "oauth_token" | "other", prompt: "<one-sentence explanation of what this is for>" }`. The user fills it in via a secure modal — the value never enters the chat transcript or the LLM. The tool returns an opaque `{{secret:<token>}}` placeholder.
4. Compose the full `.env` body with the placeholders inline:
   ```
   OPENAI_API_KEY={{secret:secret-<uuid>}}
   STRIPE_SECRET={{secret:secret-<uuid>}}
   PORT=3000
   ```
5. Write the file with `write_env_file` (NOT `write_file`). It resolves every `{{secret:…}}` at write time, sets `0o600` on Unix, and refuses to overwrite git-tracked files without `acknowledge_overwrite_tracked: true`.
6. Verify `.env` is listed in `.gitignore`; add it if missing.

**Hard rules — do not violate:**

- Do NOT ask the user to "paste your API key here" in chat. Use `manage_secrets`.
- Do NOT call `write_file` / `edit_file` for `.env`; only `write_env_file` resolves secret placeholders.
- Do NOT echo the `{{secret:…}}` placeholder back to the user — it is internal plumbing.
- If the user pastes a secret into chat anyway, refuse to use it (it is compromised the moment it hits the LLM provider) and request it again via the secure modal.

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

### Step 7 — Launch the App

After a successful setup, **start the app and open it in WorkStation automatically**.

#### Detect the launch command

| Project type          | Preferred launch command                                   |
| --------------------- | ---------------------------------------------------------- |
| Node (`dev` script)   | `npm run dev` / `pnpm run dev` / `yarn dev`                |
| Node (`start` script) | `npm start` / `pnpm start`                                 |
| Node (Next.js)        | `npm run dev` → `http://localhost:3000`                    |
| Node (Vite)           | `npm run dev` → `http://localhost:5173`                    |
| Node (CRA)            | `npm start` → `http://localhost:3000`                      |
| Python Django         | `python manage.py runserver` → `http://localhost:8000`     |
| Python FastAPI/Flask  | `uvicorn main:app` / `flask run` → `http://localhost:8000` |
| Rust (`cargo run`)    | `cargo run` (likely CLI/desktop — no URL)                  |
| Go                    | `go run .` (check for `http.ListenAndServe` to find port)  |

1. Read `package.json` (if present) and look for `dev`, `start`, or `serve` scripts — prefer `dev` over `start`.
2. For non-Node projects, check for web server patterns in the main entry point.
3. Determine the default port from config files or common defaults.

#### Start the app

Run the launch command in the background:

```json
{ "command": "<launch command>", "cwd": "<project_root>", "background": true }
```

Wait 3–5 seconds for the server to bind, then confirm it's listening:

```json
{
  "command": "curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/",
  "cwd": "<project_root>"
}
```

#### Signal WorkStation to open the app

Once the app is running, call `setup_repo` with `action: "launch_app"`:

**Web app (has a localhost URL):**

```json
{
  "tool": "setup_repo",
  "action": "launch_app",
  "url": "http://localhost:<port>",
  "app_type": "web",
  "command": "<launch command>"
}
```

**Non-web app (CLI / desktop / Tauri):**

```json
{
  "tool": "setup_repo",
  "action": "launch_app",
  "app_type": "desktop",
  "command": "<launch command>"
}
```

The WorkStation UI will open a browser tab to the URL automatically.
If there is no URL, the user sees the app running in the terminal.

#### Edge cases

- If the app fails to start (port already in use, missing env var, build error) → fix the issue first, then retry.
- If the project is a library (no runnable entry point) → skip launch and report setup complete.
- If the port is non-standard, extract it from the launch command output or config file.

## Tauri Projects

Tauri projects require **both** Node and Rust setup:

1. Install Node deps first: `pnpm install` (or yarn/npm)
2. Then Rust: `cargo fetch --manifest-path src-tauri/Cargo.toml`
3. Optional smoke-check: `cargo check --manifest-path src-tauri/Cargo.toml`

## Checklist

- [ ] Working directory confirmed as project root
- [ ] All toolchains detected
- [ ] README.md and `.env.example` read before running commands
- [ ] `.env` created via `write_env_file`; every secret was captured through `manage_secrets` (never pasted into chat)
- [ ] All dependency install commands succeeded (or errors surfaced)
- [ ] Setup scripts run if documented
- [ ] Smoke-check passed and result reported to user
- [ ] App launched (background process started)
- [ ] `setup_repo` called with `action: "launch_app"` so WorkStation opens the app
