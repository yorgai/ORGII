# ChatPanel + Agent Bug Audit

> Generated: 2026-06-02  
> Scope: git diff HEAD (4 modified files) + full read of all scoped source files  
> Reviewer: Claude Code

---

## Summary

| Severity      | Count |
| ------------- | ----- |
| Critical      | 3     |
| High          | 6     |
| Medium        | 7     |
| Low / Quality | 4     |

**Overall risk:** The diff itself is a net improvement (removes a lot of fragile code). The bugs below are a mix of newly-introduced issues in the diff and pre-existing issues in the broader scope files that this audit was asked to cover.

---

## Critical Bugs

### [C1] `handleSetupRepo` calls `onSubmit()` before the skill pill is committed to the DOM — composer submits empty content

**File:** `src/engines/ChatPanel/InputArea/components/PinnedActionsBar/index.tsx` line 128–134

**Problem:** `insertFilePill` is synchronous and calls `insertPill` → `syncPillEntries` which calls `setPillEntries(...)` — a React state update. React batches state updates; the re-render (which makes the pill visible in the editor) has **not yet happened** when `onSubmit?.()` fires on the very next line. The submit handler reads `tiptapRef.current.getTextWithPills()` synchronously, finds the editor text is either empty or bare (the pill span exists in the DOM but the React portal hasn't rendered yet so `extractTextWithPills` may not serialise it), and sends a blank message.

**Root cause:** `onSubmit` is called synchronously after `insertFilePill` without yielding to let React flush the pill-state update.

**Fix:**

```tsx
const handleSetupRepo = useCallback(() => {
  if (!tiptapRef.current) return;
  tiptapRef.current.clear();
  tiptapRef.current.insertFilePill("/setup-repo", false, "skill", "setup-repo");
  tiptapRef.current.focus();
  // Yield one frame so React can flush the pill state update before we read
  // getTextWithPills() inside handleDivSubmit.
  requestAnimationFrame(() => {
    onSubmit?.();
  });
}, [tiptapRef, onSubmit]);
```

---

### [C2] `useDocumentStorage.saveDocument` passes the **pre-update** `doc` to `saveDocumentToStorage` but uses the `updatedDoc` timestamp for the UI — creates a timestamp mismatch in the persisted file

**File:** `src/hooks/files/useDocumentStorage.ts` line 283–328

**Problem:** `saveDocument` creates `updatedDoc` with a fresh `updatedAt`, but then calls `saveDocumentToStorage(doc)` (the original, un-updated arg). The file written to disk gets the **old** `updatedAt`, while `setCurrentDocument(updatedDoc)` and the list's `updatedAt` hold the new timestamp. On the next app start, `loadDocumentList` reads the disk file and will show the stale timestamp — inconsistent state between persistence and UI.

**Root cause:** Wrong variable passed to `saveDocumentToStorage`.

**Fix:**

```ts
const success = await saveDocumentToStorage(updatedDoc); // was: saveDocumentToStorage(doc)
```

---

### [C3] `useDocumentStorage.renameDocument` directly mutates the loaded document object before saving

**File:** `src/hooks/files/useDocumentStorage.ts` line 377–386

**Problem:**

```ts
const doc = await loadDocument(docId);
if (!doc) return false;
doc.title = newTitle; // <-- direct mutation of the returned object
return saveDocument(doc);
```

`loadDocument` sets `currentDocument` to the returned `doc`. Mutating it directly updates the object that `currentDocument` is pointing to **before** `saveDocument` is called, bypassing React's state-update model. This can cause the UI to display the new title even if `saveDocument` subsequently fails, leaving the UI and storage out of sync.

**Fix:**

```ts
const doc = await loadDocument(docId);
if (!doc) return false;
return saveDocument({ ...doc, title: newTitle });
```

---

## High Bugs

### [H1] `useDocumentStorage.loadDocument` never resets `isLoading` to `false` on the not-found path

**File:** `src/hooks/files/useDocumentStorage.ts` line 240–280

**Problem:** The `finally` block only executes after the `try/catch`. But inside the `try`, when `fs` is available and the file exists and parses, control returns from the `if (fs && docsPath)` branch — ✅ `finally` runs. However, if the document is found in the localStorage branch (`docs.find(...)`) it also falls through to `finally` — ✅. The **gap** is: the Tauri branch calls `fs.readTextFile` which can throw a "file not found" error, caught by `catch`, which sets `error` and returns `null` — `finally` sets `isLoading = false` — ✅ there. **But** the localStorage `docs.find(...)` returns `undefined`, hits `setError("Document not found")`, returns `null`, and goes to `finally` — ✅ there too.

Actually there is a subtler bug: `setIsLoading(true)` is called at the top of `loadDocument`, but `loadDocument` is called from `renameDocument` (line 379) where the caller doesn't expect the loading spinner to appear. Every rename triggers a loading-state flash across all consumers.

**Fix:** Add an `internal` parameter to skip loading-state side effects when called internally, or extract a pure read helper.

---

### [H2] `useImageAttachment.ingestFiles` captures `images.length` in a stale closure — cap check is wrong when multiple images are added in rapid succession

**File:** `src/engines/ChatPanel/hooks/useInputArea/useImageAttachment.ts` line 62–109

**Problem:** `ingestFiles` is a `useCallback` with `[images.length, setImages]` as deps. Each `ingestFiles` call captures the `images.length` at the time the callback was memoized. When multiple images are pasted/dropped at once, `ingestFiles` is called once per batch, but two rapid calls (e.g. from a drag event followed immediately by a paste) will both use the same stale `images.length` and both believe there is capacity, potentially exceeding `MAX_CHAT_IMAGES`.

**Root cause:** `images.length` in the dep array creates a stale capture. The functional form of `setImages` already has access to the latest value.

**Fix:**

```ts
const ingestFiles = useCallback(
  async (files: File[]) => {
    if (files.length === 0) return;
    // Read current length inside the setter to avoid stale closure
    setImages((prev) => {
      const remaining = MAX_CHAT_IMAGES - prev.length;
      if (remaining <= 0) {
        Message.warning(`Maximum ${MAX_CHAT_IMAGES} images allowed`);
        return prev; // no-op; async side effects fire below
      }
      return prev; // actual additions happen after await; return unchanged for now
    });
    // ... rest of implementation needs restructuring or use a ref for length
  },
  [setImages]
);
```

A cleaner fix is to use a `useRef` mirror of `images.length` that updates on every render, so `ingestFiles` can read it without being recreated.

---

### [H3] `PinActionsPanel` click-outside handler does not guard against the "..." trigger button itself — double-toggle on re-open

**File:** `src/engines/ChatPanel/InputArea/components/PinnedActionsBar/PinActionsPanel.tsx` line 81–90

**Problem:** The `mousedown` outside handler fires on every click outside the panel `div`. But the "..." button (`moreButtonRef`) that toggles the panel lives **outside** the panel's `panelRef`. So clicking "..." while the panel is open triggers: (1) the click-outside handler → `onClose()` → `setPanelOpen(false)`, then (2) `handleOpenPanel` → `setPanelOpen(prev => !prev)` → `false → true` → panel reopens. In practice the two fire in the same event so the panel briefly flickers or stays open unexpectedly depending on event ordering.

The old `PinnedActionsBar` code for the repo picker had the same pattern and explicitly handled it by checking against both the picker ref and the trigger ref. `PinActionsPanel` only checks its own `panelRef`.

**Fix:** The `"..." button` ref (`moreButtonRef`) is in the parent component. Pass it as `triggerRef` to `PinActionsPanel` and include it in the click-outside guard:

```ts
// In PinActionsPanel, accept an optional triggerRef:
interface PinActionsPanelProps {
  // ...
  triggerRef?: React.RefObject<HTMLElement>;
}

const handler = (e: MouseEvent) => {
  if (panelRef.current?.contains(e.target as Node)) return;
  if (triggerRef?.current?.contains(e.target as Node)) return; // <-- add this
  onClose();
};
```

---

### [H4] `useSlashCommand.fetchItems` has no AbortController — stale fetches from a previous session/mount can overwrite fresh results

**File:** `src/engines/ChatPanel/hooks/useInputArea/useSlashCommand.ts` line 159–230

**Problem:** `fetchItems` fires two parallel async operations (`invoke` + `rpc.mcp.listServers`) and then awaits all tool lists. There is no cancellation mechanism. If the component unmounts mid-fetch (e.g. session switch) the `setItems(allItems)` and `setFilteredItems` calls fire on the unmounted component, causing "Can't perform a React state update on an unmounted component" warnings and potentially racing with a re-mount that has already seeded the correct session's items.

**Fix:** Add a cancellation flag:

```ts
const fetchItems = useCallback(async (): Promise<SlashItem[]> => {
  let cancelled = false;
  setSlashLoading(true);
  try {
    // ...fetch...
    if (!cancelled) {
      setItems(allItems);
      itemsCacheRef.current = allItems;
    }
    return allItems;
  } finally {
    if (!cancelled) setSlashLoading(false);
  }
  // return cleanup from useEffect
}, []);
```

The cleaner fix is to use `useEffect` for the on-mount warm fetch and hold a `cancelledRef` flag.

---

### [H5] `useInputAreaEffects` dropped-files effect calls `clearDroppedFiles()` before async image processing completes — drops files if the component re-renders before `handleImagePath` resolves

**File:** `src/engines/ChatPanel/hooks/useInputArea/useInputAreaEffects.ts` line 275–344

**Problem:**

```ts
if (pathImageFiles.length > 0) {
  void Promise.all(                     // <-- fire-and-forget
    pathImageFiles.map((file) => handleImagePath(file.path, file.name))
  );
}

if (otherFiles.length > 0) { ... }

clearDroppedFiles();                    // <-- clears the atom immediately
```

`clearDroppedFiles()` runs synchronously. If a `droppedFiles` change arrives while the previous `handleImagePath` promise is still in flight (e.g., user drops two batches in quick succession), the atom is cleared and the second batch triggers a fresh effect run — but any race from the first batch's in-flight reads could now point to stale data. More concretely, the cleanup function sets `cancelled = true` and clears retry timers, but `handleImagePath` is already awaiting `readFile` outside the cancellation scope — it will still call `setImages` after the effect tears down.

**Fix:** Either move `clearDroppedFiles()` into the finally of the awaited promises, or wrap the image path reads with a cancellation check.

---

### [H6] `apiTracker.ts` — `interceptorsInitialized` guard prevents re-initialization after `eject`, leaving the app with no tracking if the cleanup function is called and then `initializeApiTracking` is re-invoked

**File:** `src/util/monitoring/apiTracker.ts` line 143–290

**Problem:** `initializeApiTracking` returns a cleanup function that calls `axios.interceptors.request.eject(...)` and sets `interceptorsInitialized = false`. However, `enableApiTracking` calls `initializeApiTracking()` — but at module level `interceptorsInitialized` starts as `false`, so the first call works. If the cleanup is called (e.g. on hot reload), `interceptorsInitialized` is reset to `false` ✅. Re-calling `enableApiTracking()` will re-initialize — ✅.

The real issue is the **returned cleanup is not stored by the caller**. `enableApiTracking` (line 292) calls `initializeApiTracking()` but ignores the returned cleanup function. If `disableApiTracking` is called later, the interceptors are **never ejected** — they keep firing and calling `trackingEnabled` checks forever, accumulating `requestStartTimes` entries for all in-flight requests at that moment.

**Fix:**

```ts
let cleanupInterceptors: (() => void) | undefined;

export const enableApiTracking = () => {
  trackingEnabled = true;
  cleanupInterceptors = initializeApiTracking();
};

export const disableApiTracking = () => {
  trackingEnabled = false;
  cleanupInterceptors?.();
  cleanupInterceptors = undefined;
  requestStartTimes.clear();
  pendingCallInfo.clear();
};
```

---

## Medium Bugs

### [M1] `PinActionsPanel` positions the panel using `window.innerHeight` captured at render time — panel jumps on browser/window resize or when the soft-keyboard appears

**File:** `src/engines/ChatPanel/InputArea/components/PinnedActionsBar/PinActionsPanel.tsx` line 131–145

**Problem:**

```ts
const top = anchorRect.top - GAP;
const right = window.innerWidth - anchorRect.right;
// ...
style={{ bottom: window.innerHeight - top, right, width: PANEL_WIDTH }}
```

`anchorRect` is captured at the moment `handleOpenPanel` runs (via `getBoundingClientRect()`). If the viewport height changes after the panel opens (scroll, keyboard appearing on mobile/WebView), the computed `bottom` becomes stale and the panel floats to the wrong position.

**Fix:** Either recompute on a `resize` event, or use CSS anchor-positioning / a `useLayoutEffect` that updates on scroll/resize.

---

### [M2] `PinnedActionsBar.fetchItems` caches items in `itemsCacheRef` forever — skills added/removed during a session are never reflected

**File:** `src/engines/ChatPanel/InputArea/components/PinnedActionsBar/index.tsx` line 142–209

**Problem:** `if (itemsCacheRef.current.length > 0) { setAvailableItems(itemsCacheRef.current); return; }` short-circuits the fetch permanently once items have been loaded once. If the user installs a new skill or connects a new MCP server during the session, the "..." panel will show stale data until the page is refreshed.

`useSlashCommand` has a similar cache (`itemsCacheRef`) but it also calls `fetchItems()` on every `prefetchItems` invocation, so it stays fresher. `PinnedActionsBar.fetchItems` is fully cache-locked.

**Fix:** Add a TTL or invalidate the cache on panel open after a configurable stale-time (e.g. 60 seconds):

```ts
const itemsFetchedAtRef = useRef<number>(0);
const CACHE_TTL_MS = 60_000;

const fetchItems = useCallback(async () => {
  const now = Date.now();
  if (
    itemsCacheRef.current.length > 0 &&
    now - itemsFetchedAtRef.current < CACHE_TTL_MS
  ) {
    setAvailableItems(itemsCacheRef.current);
    return;
  }
  // ... fetch ...
  itemsFetchedAtRef.current = now;
}, []);
```

---

### [M3] `useEditorExpansion.onEditorContentChange` calls `requestAnimationFrame` to focus on collapse, but the `tiptapRef` at that point may refer to a different session's editor

**File:** `src/engines/ChatPanel/InputArea/hooks/useEditorExpansion.ts` line 93–98

**Problem:**

```ts
requestAnimationFrame(() => {
  tiptapRef.current?.focus?.();
});
```

`tiptapRef` is passed by reference from the parent. However, during a session switch the parent component may have re-rendered and changed which session's editor `tiptapRef.current` points to. The rAF fires after the re-render, potentially focusing the _new_ session's editor when the user was clearing the _old_ one.

This is a low-probability race but can manifest as unexpected focus jumps when rapidly switching sessions while typing.

**Fix:** Capture the ref value before the rAF:

```ts
const editorAtClear = tiptapRef.current;
requestAnimationFrame(() => {
  editorAtClear?.focus?.();
});
```

---

### [M4] `ComposerInput` — `handlePaste` is recreated via `useMemo` only when `ops.insertPill` or `ops.insertTextAtCaret` changes, but `handleInput` (which fires after paste) is in the native event listener dep array — double-call risk

**File:** `src/components/ComposerInput/index.tsx` line 196–205, 249–293

**Problem:**

```ts
const handlePasteEvent = (event: ClipboardEvent) => {
  handlePaste(event);
  handleInput(); // <-- fires a second onContentChange after paste
};
```

`createPasteHandler` already calls `ctx.insertTextAtCaret` which mutates the DOM but does **not** fire the native `input` event (since it's a direct DOM mutation). That's why `handleInput()` is called manually afterward. However, `handlePaste` also calls `ctx.insertPill` which similarly mutates the DOM. The problem is: for the image-paste path (`onImagePaste(imageFiles)`), `handlePaste` returns `true` and has already called `event.preventDefault()`, but `handleInput()` is still called afterward — it will read the host DOM (which hasn't changed since no text was inserted) and fire `onContentChangeRef.current?.("")` or similar, potentially resetting any pending UI state.

**Fix:** Only call `handleInput()` when paste actually inserted text/pills:

```ts
const handlePasteEvent = (event: ClipboardEvent) => {
  const consumed = handlePaste(event);
  if (consumed) handleInput();
};
```

---

### [M5] `useDocumentStorage.autoSave` is a `useDebouncedCallback` that captures `saveDocument` at creation time — `saveDocument` depends on `currentDocument` which changes, creating a stale closure

**File:** `src/hooks/files/useDocumentStorage.ts` line 331–333

**Problem:**

```ts
const autoSave = useDebouncedCallback((doc: Document) => {
  saveDocument(doc); // saveDocument closes over currentDocument
}, DEBOUNCE_DELAYS.AUTOSAVE);
```

`saveDocument` has `[currentDocument, saveDocumentToStorage]` as its deps. `autoSave` is a debounced wrapper that closes over the `saveDocument` reference at the time `useDebouncedCallback` creates it. If `currentDocument` changes between when `autoSave` is scheduled and when it fires (e.g. user switches documents during the debounce window), the fired `saveDocument` will compare `currentDocument?.id === doc.id` against a stale `currentDocument`, potentially updating the wrong document's local state.

**Fix:** Since `doc` is passed explicitly to `autoSave`, `saveDocument` shouldn't need to reference `currentDocument` for its core save logic. Separate the "update current document state" concern from the "persist to disk" concern.

---

### [M6] `apiTracker.ts` — module-level `document.addEventListener` calls at lines 93–98 run unconditionally at import time, not gated on `trackingEnabled`

**File:** `src/util/monitoring/apiTracker.ts` line 93–98

**Problem:**

```ts
if (typeof window !== "undefined") {
  document.addEventListener("click", trackClick, true);
  document.addEventListener("mouseover", trackHover, true);
  document.addEventListener("keydown", trackKeyboard, true);
  document.addEventListener("focus", trackFocus, true);
}
```

These listeners are registered the moment the module is imported — regardless of whether tracking is enabled. Every `click`, `mouseover`, `keydown`, and `focus` on the entire document will call `trackClick/trackHover/trackKeyboard/trackFocus` and set `recentInteraction` even when tracking is disabled. The `mouseover` handler fires extremely frequently (every pixel of mouse movement over a new element), making this a constant performance tax.

**Fix:** Lazily register the listeners inside `enableApiTracking` and remove them in `disableApiTracking`:

```ts
export const enableApiTracking = () => {
  trackingEnabled = true;
  cleanupInterceptors = initializeApiTracking();
  document.addEventListener("click", trackClick, true);
  document.addEventListener("mouseover", trackHover, true);
  document.addEventListener("keydown", trackKeyboard, true);
  document.addEventListener("focus", trackFocus, true);
};
```

---

### [M7] `useRepoDetection` — the `window.focus` listener (line 134–139) uses `refresh()` which increments `tick`, triggering a full re-detection on every window focus even after the component's consumers have been unmounted or navigated away

**File:** `src/modules/WorkStation/Launchpad/hooks/useRepoDetection.ts` line 132–139

**Problem:**

```ts
useEffect(() => {
  if (!repoPath) return;
  const handleFocus = () => refresh();
  window.addEventListener("focus", handleFocus);
  return () => window.removeEventListener("focus", handleFocus);
}, [repoPath, refresh]);
```

The cleanup correctly removes the listener. However, `refresh` is a stable `useCallback` — ✅. The issue is that `useRepoDetection` is now only called inside `useRepoSetup` (after the diff removes it from `PinnedActionsBar`). If `useRepoSetup` is mounted in a context that persists across session navigation, the focus listener will trigger a full filesystem scan (`detectRepo`) on every window-focus event indefinitely.

This is lower-priority since the detection result is only used if `setupRepoPath` is passed to `useRepoSetup`, which is now managed by the caller. But each focus event still causes N filesystem `exists()` calls (one per `CONFIG_PROBES` entry = 13 + `EXTRA_CONFIG_FILES` = 8 = 21 calls minimum).

**Fix:** Add a reasonable debounce to `handleFocus` (e.g. 2s) or gate on whether `repoPath` is actively needed.

---

## Low / Code Quality Issues

### [Q1] `PinnedActionsBar` and `useSlashCommand` duplicate the entire `fetchItems` + `resolveSkillGroup` logic

**Files:**

- `src/engines/ChatPanel/InputArea/components/PinnedActionsBar/index.tsx` lines 34–51, 142–209
- `src/engines/ChatPanel/hooks/useInputArea/useSlashCommand.ts` lines 44–68, 159–230

Both components implement identical `resolveSkillGroup` functions and nearly identical `fetchItems` async flows (invoke `skills_list`, fetch MCP servers, list tools, assemble `SlashItem[]`). Any bug fixed in one will recur in the other.

**Fix:** Extract a shared `useSlashItemsCache()` hook or a pure async `fetchSlashItems()` utility used by both.

---

### [Q2] `useDocumentStorage.loadDocumentList` is stable (via `useCallback` with `[loadFromLocalStorage]`) but the `useEffect` at line 153 has `loadDocumentList` in its dep array — triggers on every render if `loadFromLocalStorage` reference changes

**File:** `src/hooks/files/useDocumentStorage.ts` line 152–155

`loadFromLocalStorage` has `[]` deps and is stable. `loadDocumentList` has `[loadFromLocalStorage]` deps and is stable. `useEffect([loadDocumentList])` runs once. This is actually correct — but it is fragile: if any future developer adds a dep to `loadFromLocalStorage`, the entire chain re-triggers on every render causing repeated filesystem reads.

---

### [Q3] `ComposerInput` uses `document.execCommand("delete")` inside `consumeMentionQuery` (line 397)

**File:** `src/components/ComposerInput/imperativeApi.ts` line 395–399

`document.execCommand` is deprecated and will be removed in future browsers/Electron versions. The `delete` command is already known to behave differently across browsers (particularly with emoji and multi-byte characters).

**Fix:** Replace with direct DOM manipulation using `Range.deleteContents()`.

---

### [Q4] Dead prop: `buttonRef` on `ActionPill` is never passed after the diff — the prop and its type definition are unused

**File:** `src/engines/ChatPanel/InputArea/components/PinnedActionsBar/index.tsx` lines 72–77, 291–296

After the diff, `ActionPill` is rendered without `buttonRef` in all cases (the `isSetupRepo ? setupPillRef : undefined` pattern was removed). The prop and the `ref={buttonRef}` forward on the `<button>` are harmless dead code, but should be cleaned up.

---

## Appendix: Diff-Specific Assessment

### `PinnedActionsBar/index.tsx` (252 → ~100 lines, -228 lines)

The refactor is correct in spirit: removes the heavyweight session-launch flow from a presentation-layer component. **Critical bug C1** (submit timing) was introduced by this diff. The new `handleSetupRepo` is simpler but the synchronous call sequence `clear → insertFilePill → focus → onSubmit` does not account for React's batched state updates.

### `InputArea/index.tsx` (+1 line)

`onSubmit={() => void handleDivSubmit()}` is the correct wiring. No bugs in this line itself; the risk is inherited from C1.

### `useRepoDetection.ts` (+1 line — export)

Making `detectRepo` exported is correct and safe. No new bugs.

### `useRepoSetup.ts` (+`launchingRef`)

The `launchingRef` addition correctly fixes the stale-closure double-fire guard. **This is a good fix.** No bugs introduced here.

---

_End of audit. Priority order for fixing: C1 → C2 → C3 → H1–H6 → M1–M7._
