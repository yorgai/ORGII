# ORGII Mobile PWA (Phase 5 spike)

A standalone Vite + React + TypeScript browser app that connects to the
ORGII mobile-remote relay over WebSocket and renders a fleet-view
session list. This is the Phase 5 spike from
`Documentation/MainApp/collaboration/mobile-remote-control--0504.md`.

## Browser-only — NOT a Tauri app

This package is meant to run in a phone's mobile browser (or be served
as an installable PWA). It must not import `@tauri-apps/api` or any
desktop-only module. The `orgii-frontend` workspace rule that forbids
`isTauriApp()` checks does not apply here, because there is no Tauri.

## Layout

- `index.html` — minimal shell, mounts `<div id="root">`
- `src/main.tsx` — bootstraps React 18
- `src/App.tsx` — three-state machine (Unpaired / Connecting / Connected)
- `src/RemoteSessionList.tsx` — fleet-view session list
- `src/api/relay.ts` — `RelayClient` WebSocket shim over `Frame`
- `src/index.css` — minimal mobile-first stylesheet (system fonts only)
- `public/icons/icon-192.svg`, `icon-512.svg` — placeholder app icons
- `vite.config.ts` — Vite config with `vite-plugin-pwa`

## Develop

```bash
cd mobile-pwa
npm install
npm run dev
```

Dev server listens on **port 5174** (deliberately different from the
desktop webpack on 5173 / 1420).

## Build

```bash
npm run build
```

Outputs static files to `mobile-pwa/dist/`. Serve them from any static
host, or (Phase 6+) drop them into the relay's static-files directory.

## Wire format

`src/api/relay.ts` mirrors the Rust `Frame` enum from
`src-tauri/crates/orgii-protocol/src/frames.rs`:

- top-level discriminant is `kind` (snake_case)
- `RpcResult` is itself a tagged union with `outcome: "ok" | "err"`
- `Handshake` is sent as the first WS message and is the
  `Frame::Handshake` variant (`kind: "handshake"`) — there is no
  separate top-level envelope. Every inbound message goes through
  the same `JSON.parse` + `switch (parsed.kind)` decode path.

Always treat `frames.rs` and `version.rs` as the source of truth. If
the wire shape changes there, this file must be updated by hand;
there is no codegen yet.

## Pairing model in this spike

- The user pastes the relay URL and desktop ID into a form. There is
  no QR scan, no SAS confirmation phrase, no `/pair/claim` round-trip.
- The hardcoded user id is `local-user`, matching the desktop's
  `PLACEHOLDER_USER_ID` constant in
  `src-tauri/src/api/mobile_remote/pairing/commands.rs`.
- The PWA passes `user_id` and `desktop_id` as query parameters on the
  WebSocket URL because browsers cannot set custom headers on
  `new WebSocket(...)`. The relay's mobile WS handler must accept this
  shape; coordinate with the relay agent.

## What this does NOT do yet

- Real pairing (QR + SAS phrase) — gated for Phase 5/6.
- Audit log viewer — gated for Phase 7+.
- Tool-call approve / deny UI — gated for Phase 7+.
- Event subscription (`Frame::Subscribe`) — only request/response RPCs
  today; live session updates land in Phase 6.
- Real PNG icons (currently SVG placeholders) — swap before App Store
  / production deployment.

Each deferral has a corresponding TODO in the relevant source file.
