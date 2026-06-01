//! Reach into Cursor's renderer-side `IInstantiationService` so we can
//! call workbench services (`composerService`, `composerChatService`,
//! `commandService`, …) directly instead of driving the UI.
//!
//! ## Why this module exists
//!
//! Earlier phases reached the instantiation service via a hardcoded
//! `__reactFiber` walk: anchor on `[data-composer-id]` (the live
//! composer DOM node), step up the fiber chain by exactly 13, read
//! `memoizedProps.rootWorkspace.instantiationService`. That worked
//! against a *warm* probe with at least one composer mounted, but
//! fell over in two cases we hit in practice:
//!
//! 1. **Cold probe.** A freshly-spawned Cursor with an empty
//!    `state.vscdb` boots into the Agents view with no composer
//!    present, so `[data-composer-id]` doesn't exist and the walk
//!    can't even start. (This is the bug that motivated the rewrite —
//!    `open_new_composer` couldn't open the *first* composer because
//!    its bootstrap required a composer to already exist.)
//! 2. **Layout drift.** Depth 13 was empirical against Cursor 3.2.x.
//!    A future Cursor wrapping HBC in one extra HOC would silently
//!    break every CDP call we make.
//!
//! ## What this module provides
//!
//! [`prelude`] returns a JS payload that defines two functions in
//! the renderer's global scope:
//!
//! ```js
//! findInstantiationService(): IInstantiationService    // throws if not found
//! lookupService(is, name): T | null                    // _services._entries iteration
//! ```
//!
//! `findInstantiationService` is anchor-agnostic and depth-agnostic:
//! it walks the entire DOM looking for any element with a React
//! fiber, then walks the fiber chain looking for any ancestor whose
//! `memoizedProps.{rootWorkspace,workspace}?.instantiationService`
//! is an object we can iterate. The two prop names mirror the two
//! surfaces we hit in practice:
//!
//! - `rootWorkspace` — embedded composer view (warm, at least one
//!   composer mounted in the DOM).
//! - `workspace` — standalone "Cursor Agents" view (cold probe,
//!   no composer mounted; this is the only path that actually
//!   exists on a freshly-spawned probe).
//!
//! Tries multiple anchors in priority order so the first one that
//! yields a valid IS short-circuits.
//!
//! ## Anchor priority
//!
//! 1. `[data-composer-id]` — the live composer. Cheapest if a
//!    composer is mounted.
//! 2. `.monaco-workbench` — always present on the workbench frame,
//!    even on a cold probe with no composers. Different depth-to-IS
//!    than the composer anchor; we scan instead of hardcoding.
//! 3. `body` — last resort; always exists.
//!
//! ## What we do not do
//!
//! - We do **not** cache the IS reference between calls. Cursor's
//!   workbench can re-instantiate the React tree on profile change
//!   or window reload, and a stale fiber holds a stale IS. The
//!   per-call walk is cheap (<5 ms) so caching isn't worth the
//!   cache-invalidation surface.
//! - We do **not** reach for HBC-specific props (e.g.
//!   `onSelectAgent`) here. Routing needs HBC and walks fibers
//!   itself looking for `memoizedProps.onSelectAgent` — see
//!   [`crate::routing::route_to_composer`].

/// JS prelude: defines `findInstantiationService()` and
/// `lookupService(is, name)` in the renderer scope. Inline this at
/// the top of an `evaluate()` payload, then call the two helpers.
///
/// Returns the prelude as a `&'static str` so callers compose it via
/// `format!("{prelude}\n…", prelude = workbench::PRELUDE)` without
/// allocating per call.
pub const PRELUDE: &str = r#"
function findInstantiationService() {
  // Cursor's React tree exposes the workbench instantiation service
  // on a HOC several levels above any rendered DOM node. The exact
  // prop path depends on the surface:
  //
  //   - Standalone "Cursor Agents" view (cold probe, no composer
  //     mounted): `memoizedProps.workspace.instantiationService`
  //   - Embedded composer view (warm — at least one composer in the
  //     DOM): `memoizedProps.rootWorkspace.instantiationService`
  //
  // We try anchors in priority order, then within each anchor walk
  // `fiber.return` and check both prop paths at each level. First
  // path that produces an IS with `_services._entries` short-circuits.
  const anchors = [
    document.querySelector("[data-composer-id]"),
    document.querySelector(".monaco-workbench"),
    document.body,
  ].filter(Boolean);

  function isValidIS(v) {
    return v && typeof v === "object" && v._services && v._services._entries;
  }

  for (const anchor of anchors) {
    let el = anchor;
    let fiber = null;
    while (el && !fiber) {
      const key = Object.getOwnPropertyNames(el).find(k => k.startsWith("__reactFiber"));
      if (key) fiber = el[key];
      el = el.parentElement;
    }
    if (!fiber) continue;

    // Walk fiber.return up to ~30 levels. Empirically the carrier
    // frame sits between depth 1 and depth 19 depending on which
    // anchor we started from and which surface is mounted.
    let cursor = fiber;
    let depth = 0;
    while (cursor && depth <= 30) {
      const props = cursor.memoizedProps;
      if (props && typeof props === "object") {
        // `rootWorkspace` is the warm-composer path; `workspace` is
        // the cold-probe path. Either is fine — both expose the
        // same IInstantiationService instance.
        const candidate =
          props.rootWorkspace?.instantiationService ??
          props.workspace?.instantiationService;
        if (isValidIS(candidate)) return candidate;
      }
      cursor = cursor.return;
      depth++;
    }
  }

  throw new Error("no instantiationService found via any anchor (workbench may not be initialized yet)");
}

function lookupService(is, name) {
  // `_services._entries` is a Map<ServiceIdentifier, Service>. The
  // identifier's `toString()` is the service id we want (e.g.
  // `"composerService"`); comparing with `String(id) === name`
  // works across both the `IServiceIdentifier` symbol-style and
  // older string-typed registrations.
  for (const [id, svc] of is._services._entries) {
    if (String(id) === name) return svc;
  }
  return null;
}
"#;
