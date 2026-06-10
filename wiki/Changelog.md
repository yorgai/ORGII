# Changelog

🌐 **English** · [Français](Changelog.fr) · [中文](Changelog.zh)

This page summarizes what shipped each month. The full day-by-day activity log is visible inside the app under **Changelog** in the left sidebar.

---

## June 2026

### Agent Org group chat & coordination

- Group chat is now the default view for Agent Org team conversations, with live bubble streams, progress indicators, and non-interrupting message routing so active member work is not disrupted.
- Added direct member messaging, @-mention routing, and round-based turn coordination for clearer multi-agent conversations.
- Added intervention state surfaces so human oversight moments are visible inside team workflows.

### WorkStation & source control

- Redesigned the PR section in the Source Control sidebar with shared tokens, compact actions, and safer recreate behavior after a PR is closed or merged.
- Added GitHub Issues browsing directly inside WorkStation with sidebar wiring and Source Control-aligned filters.
- Added diff selection actions that copy file references and send selected changes into chat for faster review prompts.
- Added push-to-talk voice input in the chat composer.

### Canvas

- Canvas artifacts can now flow from agent output into chat and WorkStation as inline blocks or a dedicated preview tab.
- Canvas simulator app surfaces, `setup_repo` chat blocks, and chat-to-simulator jumps added for richer generated-app previews.

### Session & replay

- Added Session JSON import and export for moving or inspecting session data.
- Added Benchmark Runner execution modes and reusable batch task management flows.
- Serialized SQLite writers to prevent session database lock storms during high-volume activity.

---

## May 2026

### Agent Orgs runtime

- Agent Org members now run as real executable sessions, with launch snapshots, wake semantics, atomic task claims, and member-state evidence for richer runtime tracking.
- Added pause and resume controls — replacing stop — with state persisted across app restarts and sidebar session restoration on relaunch.
- Improved worktree-aware subagents so member runs operate with accurate repository context.
- Added task queue evidence and locked evidence classification rules for consistent runtime categorization.

### Authentication & providers

- Added OAuth flows for Gemini, Claude Code, and Codex, covering embedded login, token refresh persistence, and account-switching isolation.
- GitHub device-flow authentication added with a baked public client ID and local token fallback.
- Improved Cursor CLI and API-key compatibility, reducing provider setup edge cases.

### WorkStation

- Added All Tabs dock navigation and cross-host tab switching.
- Introduced a presence pill that feeds availability context into active agent sessions.
- Added native Linear project views for inspecting Linear-linked project data inside ORGII.
- Added plan mode approval flows with clearer agent-plan review states.
- Added live streaming metrics in chat: elapsed time, token rate, and estimated completion.

### Agent configuration

- Added shared runtime-limit sections across Agent config pages with stricter capability defaults and default-off tool seeding.
- Consolidated Rules, Memory, and Evolution into a unified settings surface.
- Improved SOUL.md handling so personality context applies consistently to the intended agent flows.

---

## April 2026 and earlier

Full day-by-day logs for April 2026 back to June 2025 are available in the in-app Changelog. Open the app and select **Changelog** from the left sidebar.

---

## About this log

ORGII is developed daily. Each entry above is a high-level summary drawn from commit activity. Exact commit counts and per-day frontend/backend breakdowns are visible inside the app.

Models powering development: **GPT 5.5**, **Opus 4.6**.
