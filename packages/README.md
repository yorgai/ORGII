# `packages/` — Multi-package layout

This repository is in transition toward a four-package layout that
separates the OSS-eligible core from the commercial marketplace
overlay. The full boundary design lives in
[`Documentation/RustBackend/oss-boundary--0506.md`](../Documentation/RustBackend/oss-boundary--0506.md).

| Package | License | Status | Purpose |
|---|---|---|---|
| `marketplace-sdk/` | MIT | existing, public | Public A2A SDK for building and consuming agent apps on the ORGII Marketplace. |
| `ui/` | (internal) | existing, internal | Internal React component library shared across the desktop app. |
| `orgii_core/` | MIT | NEW (skeleton, PR 1) | OSS-eligible portion of the desktop app: agent-core, git, key-vault, integrations, system-services, types, app-paths, and the OSS-safe frontend. Will be a one-way subtree mirror of the public upstream repo (name TBD). |
| `orgii_marketplace/` | UNLICENSED (proprietary) | NEW (skeleton, PR 1) | Commercial marketplace overlay: marketplace UI, market HTTP, market session runner gating, MarketAuth, listing/provider wizards, Rust marketplace crate. Stays private. |

**Conventions:**

- Packages here are standalone (`@orgii/<name>`) and are NOT npm
  workspace members — the root `package.json` does not declare a
  `workspaces` array. This mirrors the existing style of
  `marketplace-sdk/` and `ui/`.
- `orgii_core/` never depends on `orgii_marketplace/`. Coupling
  flows only in the overlay direction; see the boundary doc for
  the explicit extension surfaces.
- Bug fixes that affect OSS code MUST land in the public upstream
  first and then be pulled down into `orgii_core/` via subtree.
  Direct edits to `orgii_core/` from this repo are forbidden once
  the subtree mirror is established.
