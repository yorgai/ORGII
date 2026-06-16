# ORGII

ORGII is a self-evolving agentic development framework for coding with agents and Agentic Orgs.

Built with Tauri and Rust, ORGII stays lightweight and RAM-friendly compared with Electron-based IDEs and heavier agentic tools. It supports bring-your-own keys and existing subscriptions across your favorite CLI agents & ORGII's resource-friendly Rust harness.

Agents can be aware of your computer's RAM, CPU, and presence status, then adapt their behavior based on your instructions. ORGII also supports the keys and subscriptions you already love and use.

Agents and GUIs support end-to-end testing, which empowers ORGII to self-evolve (with human supervision). A research paper is releasing soon. The frontend is written with our ORGII SDE Agent.

## Demo

https://github.com/user-attachments/assets/bd4833d2-4cc4-4971-9805-84529b14d01a

## Quick start

Download the latest ORGII desktop app from the [Releases](https://github.com/YORG-AI/ORGII/releases) page.

To build or contribute from source:

```bash
pnpm install
pnpm run download:sidecars
pnpm run tauri:dev
```

Useful scripts:

- `pnpm run tauri:dev` — launch the full desktop app in development mode, including the Tauri shell and frontend dev server.
- `pnpm run start:fast` — start only the webpack frontend dev server for fast UI iteration.
- `pnpm run build` — create the production frontend bundle used by desktop builds.
- `pnpm run tauri:build` — build the packaged desktop app with the default Tauri profile.
- `pnpm run tauri:build:fast` — build with the faster local development profile for quicker validation.
- `pnpm run tauri:build:fast:open` — fast iteration mode: clean only the app target for the local development profile, rebuild the Tauri app bundle, and open it immediately.
- `pnpm run download:sidecars` — download optional native helpers for Browser Use and Computer Use features.
- `pnpm run lint` / `pnpm run lint:fix` — check or automatically fix frontend lint issues.
- `pnpm run test` / `pnpm run test:coverage` / `pnpm run test:watch` — run frontend tests, coverage, or watch mode.
- `pnpm run cargo:check` — validate the Rust backend without producing a full build.
- `pnpm run cargo:test` — run Rust library tests.
- `pnpm run cargo:clippy` — run Rust lint checks.
- `pnpm run check:circular` — detect circular imports in `src/`.

For more contribution details, see [CONTRIBUTING.md](CONTRIBUTING.md). We ask everyone to be respectful and empathetic; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Optional native sidecars

Browser Use and Computer Use features rely on optional native helpers for browser automation and macOS screen automation:

- `agent-browser` is downloaded from `vercel-labs/agent-browser` releases for the current OS/CPU.
- `peekaboo` is downloaded from `steipete/peekaboo` releases on macOS.

Computer Use is currently available on macOS only. Browser Use can use `agent-browser` on supported platforms.

If a sidecar is missing, the Rust build creates a small placeholder resource so development builds can continue. The related capability may fall back to `PATH` or remain unavailable until you run `pnpm run download:sidecars`.

## License

ORGII is licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See [`LICENSE`](LICENSE) for the full license text.
