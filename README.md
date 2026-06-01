# ORGII

ORGII is a self-evolving agentic development framework for coding with agents and Agentic Orgs.

Built with Tauri and Rust, ORGII stays lightweight and RAM-friendly compared with Electron-based IDEs and heavier agentic tools. It supports bring-your-own keys and existing subscriptions across your favorite CLI agents & ORGII's resource-friendly Rust harness.

Agents and GUIs support end-to-end testing, which empowers ORGII to self-evolve (with human supervision). A research paper is releasing soon. The frontend is written with our ORGII SDE Agent.

## Quick start

Download the latest ORGII desktop app from the [Releases](https://github.com/YORG-AI/ORGII/releases) page.

If you want to build or contribute to ORGII from source, see [CONTRIBUTING.md](CONTRIBUTING.md). We ask everyone to be respectful and empathetic; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Optional native sidecars

Browser Use and Computer Use features rely on optional native helpers for browser automation and macOS screen automation:

- `agent-browser` is downloaded from `vercel-labs/agent-browser` releases for the current OS/CPU.
- `peekaboo` is downloaded from `steipete/peekaboo` releases on macOS.

Computer Use is currently available on macOS only. Browser Use can use `agent-browser` on supported platforms.

If a sidecar is missing, the Rust build creates a small placeholder resource so development builds can continue. The related capability may fall back to `PATH` or remain unavailable until you run `npm run download:sidecars`.

## License

ORGII is licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See [`LICENSE`](LICENSE) for the full license text.
