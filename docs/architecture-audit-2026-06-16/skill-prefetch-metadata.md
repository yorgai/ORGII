# Architecture Audit — Skill Prefetch Metadata (Workstream 3)

**Date:** 2026-06-16
**Auditor:** audit-then-commit session
**Scope:** `src-tauri/crates/agent-core/src/specialization/skills/prefetch.rs`

## Change summary

`PrefetchResult.skill_contents` migrated from `Vec<(String, String)>` (name, content) to `Vec<PrefetchedSkill>` carrying `{ name, source, path, content }`. `build_prompt_section` now emits `Source:`/`Path:` lines plus a "Content already prefetched; do not try to read a guessed skill path" instruction.

## Layer-by-layer (relevant layers)

### L1 Compilation

Clean. `cargo test -p agent_core --lib prefetch` → 23 passed, including the updated `prefetch_result_builds_prompt_section` which now asserts `Source: workspace`, the path string, and the "Content already prefetched" line.

### L2 Dead code / dedup

Replacing the tuple with a named struct removes the positional `.map(|(n, _)| ...)` destructuring (now `.map(|skill| skill.name.clone())`). No duplicate type — `PrefetchedSkill` is the single carrier. All fields (`name`, `source`, `path`, `content`) are consumed by `build_prompt_section` or `final_names`.

### L3 Naming

`PrefetchedSkill` is self-describing. `source`/`path` mirror the upstream skill descriptor fields (`skill.source`, `skill.path.display()`), so the provenance is traceable end-to-end.

### L7 New-developer clarity

The new prompt text is intent-revealing — it tells the model the content is already inlined and not to guess a path, which is the actual reason `path`/`source` were threaded through.

### L8 Wire protocol

This struct is prompt-section text, not a serialized API payload — no JSON boundary. `path` is rendered via `skill.path.display().to_string()` (platform-correct). No bloat.

## Correctness notes

- The conversion is a pure data-shape widening; the selection/validation flow (`valid_names` guard, read-error `warn!` + skip) is unchanged.
- `final_names` still derives from the materialized `skill_contents`, so a skill that failed to read is correctly excluded from both the prompt and the logged name list.

## Summary

- 0 blocking issues
- 0 fix candidates
- Clean tuple→named-struct refactor with provenance metadata; tests updated.
