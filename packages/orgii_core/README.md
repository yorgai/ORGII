# @orgii/orgii-core

This directory is the **OSS-eligible portion** of the ORGII desktop
application codebase. In the planned repo split, code under this
package mirrors the public upstream repository (future name TBD —
likely `orgii-core` or `orgii-lite`) and is consumed here as a
read-only subtree.

**Status:** skeleton only. PR 1 establishes the directory shape;
no real code has been moved yet. Actual extraction of `agent-core`,
`git`, `key-vault`, `integrations`, `system-services`, `types`,
`app-paths`, and the OSS-safe frontend modules happens in PR 2 and
onward.

License: MIT (matches the planned public upstream).

See `Documentation/RustBackend/oss-boundary--0506.md` for the full
boundary design, one-way sync invariants, and the per-surface
classification of what lives here vs. in `orgii_marketplace/`.
