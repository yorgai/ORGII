# ORG-2

**Open-source Cursor-style agent IDE — but built for reviewability, traceability, and control, not just faster coding.**

Built with Rust and Tauri for local-first execution under 100MB on disk. Supports agent trajectory livestream and replay. Easy to follow and review.

[English](README.md) · [Français](docs/readmes/README.fr.md) · [简体中文](docs/readmes/README.zh.md) · [繁體中文](docs/readmes/README.zh-Hant.md) · [Español](docs/readmes/README.es.md) · [Русский](docs/readmes/README.ru.md) · [Português](docs/readmes/README.pt.md) · [Deutsch](docs/readmes/README.de.md) · [日本語](docs/readmes/README.ja.md) · [한국어](docs/readmes/README.ko.md) · [Türkçe](docs/readmes/README.tr.md) · [Tiếng Việt](docs/readmes/README.vi.md) · [Polski](docs/readmes/README.pl.md)

<p align="center">
  <video src="https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a" controls width="720"></video>
</p>


It is not just another AI coding tool; it is an experiment in human/agent organizations and org-level alignment. Agents are getting better, but collaboration, observability, structure, and shared accountability are not keeping up — and in some cases are getting worse. Cursor, Claude Code, and similar tools often treat agents as outsourced assistants: useful for output, but hard to audit, coordinate, align, or evolve at a system level.

ORG-II explores a different model: agents as persistent, observable colleagues inside a structured organization. Instead of stateless, hard-to-review AI IDE sessions, it introduces replayable agent execution, cross-session memory, AI blame, and a local-first Rust-based runtime so humans, agents, and teams can collaborate around shared context and aligned goals.

## Key capabilities

- Long-running sessions with replayable execution traces for auditing, review, and debugging.
- Rust-based agents that work with your existing API keys and agent subscriptions.
- GUI, CLI, terminal, Git, browser, LSP, timeline, and database tooling.
- Cross-session memory, cross-agent knowledge sharing, and shared workspace state.
- Resource-aware execution that can react to CPU, RAM, and human attention availability.
- Agent-powered GUI end-to-end testing for supervised self-evolution.
- Scheduling and auto-started sessions so agents can run overnight or continue work when you are away.
- Org-level alignment surfaces (issues/projects management) for coordinating humans, agents, goals, and accountability (WIP).
- Session collaboration and group issue workflows via self-hosted Supabase (WIP).

<p align="center">
  <img src="assets/github-browser-demo.png" alt="ORGII GitHub browser demo" width="720" />
</p>

<p align="center">
  <img src="assets/agent-scheduling-demo.png" alt="ORGII agent scheduling demo" width="720" />
</p>

## Download

Current build version: v1.0.1.21 (2026-06-20)

Get the latest ORGII desktop app from the [Releases](https://github.com/YORG-AI/ORGII/releases) page. Open the newest release, download the installer or app bundle for your platform, and follow the OS prompts to install ORGII.

## Develop from source

To build or contribute from source:

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

For more contribution details, see [CONTRIBUTING.md](CONTRIBUTING.md). We ask everyone to be respectful and empathetic; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Optional native sidecars

Browser Use and Computer Use features rely on optional native helpers for browser automation and macOS screen automation:

- `agent-browser` is downloaded from `vercel-labs/agent-browser` releases for the current OS/CPU.
- `peekaboo` is downloaded from `steipete/peekaboo` releases on macOS.

Computer Use is currently available on macOS only. Browser Use can use `agent-browser` on supported platforms.

If a sidecar is missing, the Rust build creates a small placeholder resource so development builds can continue. The related capability may fall back to `PATH` or remain unavailable until you run `pnpm run download:sidecars`.

## License

ORGII is licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See [`LICENSE`](LICENSE) for the full license text.
