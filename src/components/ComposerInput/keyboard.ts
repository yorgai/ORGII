/**
 * Keyboard handling for ComposerInput.
 *
 * Handles keyboard behavior on a plain `keydown` listener attached to a
 * contenteditable host:
 *
 *  - IME composition guard (skipped via `event.isComposing`)
 *  - @ mention dropdown navigation delegation
 *  - Slash command dropdown navigation delegation
 *  - @ detection (after the character lands, mark mention active and notify)
 *  - / detection at position 0 in an empty editor
 *  - Enter to submit (Cmd/Ctrl+Enter or bare Enter based on `requireCmdEnter`)
 *  - Escape to close dropdowns
 *
 * All callbacks are accessed via getters at event time so a single
 * handler instance can survive every prop change without re-binding.
 */
import { caretTextOffset, rangeInsideHost } from "./selection";

const DROPDOWN_NAV_KEYS = ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"];

export interface MentionState {
  active: boolean;
  /**
   * Character offset (within `getText()`) of the position right after the
   * trigger character. The active query is the substring from `startOffset`
   * to the current caret position.
   */
  startOffset: number;
  /**
   * `true` when the trigger was a typed "@" key (the character lives in the
   * editor at `startOffset - 1`), `false` when opened programmatically via
   * `triggerAtMention()`.
   */
  hasAtChar?: boolean;
  hasTriggerChar?: boolean;
}

export interface KeyDownHandlerContext {
  host: () => HTMLDivElement | null;
  isComposing: () => boolean;
  getAtMention: () => MentionState;
  setAtMention: (state: MentionState) => void;
  getSlashCommand: () => MentionState;
  setSlashCommand: (state: MentionState) => void;
  getOnKeyDownForDropdown: () =>
    | ((event: KeyboardEvent) => boolean)
    | undefined;
  getOnKeyDownForSlashDropdown: () =>
    | ((event: KeyboardEvent) => boolean)
    | undefined;
  getOnAtMention: () =>
    | ((query: string, pos: { x: number; y: number }) => void)
    | undefined;
  getOnAtMentionClose: () => (() => void) | undefined;
  getOnSlashCommand: () =>
    | ((query: string, pos?: { x: number; y: number }) => void)
    | undefined;
  getOnSlashCommandClose: () => (() => void) | undefined;
  getOnSubmit: () => ((text: string) => void) | undefined;
  getOnBeforeNewline: () => (() => void) | undefined;
  /** Read the plain-text content of the editor (pills serialized to fileName) */
  getText: () => string;
  /** Insert a literal newline at the caret. Used for Shift+Enter / bare Enter. */
  insertNewline: () => void;
  /** Whether bare Enter inserts a newline (false) or submits (true). */
  requireCmdEnter: boolean;
  slashTriggerMode: "command" | "context";
}

/**
 * Read caret coordinates so the host can position the @ mention popover.
 * Falls back to the host's bounding box if there is no live range (e.g. the
 * user never clicked into the editor before triggering @).
 */
function caretCoords(host: HTMLElement): { x: number; y: number } {
  const range = rangeInsideHost(host);
  const rects = range.getClientRects();
  if (rects.length > 0) {
    const rect = rects[0];
    return { x: rect.left, y: rect.bottom };
  }
  const rect = host.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

export function createKeyDownHandler(ctx: KeyDownHandlerContext) {
  return (event: KeyboardEvent): void => {
    if (event.isComposing || ctx.isComposing()) return;
    const host = ctx.host();
    if (!host) return;

    const onAtKeys = ctx.getOnKeyDownForDropdown();
    if (ctx.getAtMention().active && onAtKeys) {
      if (DROPDOWN_NAV_KEYS.includes(event.key)) {
        const handled = onAtKeys(event);
        if (handled) {
          event.preventDefault();
          return;
        }
      }
    }

    const onSlashKeys = ctx.getOnKeyDownForSlashDropdown();
    // Delegate to the slash-command dropdown handler when:
    //   a) the inline "/" menu is active (slashCommandRef.active), OR
    //   b) the handler itself accepts the key (covers the "+" button header menu
    //      where slashCommandRef.active is always false because no "/" was typed).
    // This avoids a double-guard where slashCommandRef.active is false but the
    // dropdown is visibly open (opened via button, not via typed "/").
    if (onSlashKeys && DROPDOWN_NAV_KEYS.includes(event.key)) {
      const handled = onSlashKeys(event);
      if (handled) {
        event.preventDefault();
        return;
      }
    }

    // Cmd/Ctrl+A → select all editor content. Webkit-based contenteditable
    // hosts that have `display: block` + `white-space: nowrap` (the compact
    // chat row) sometimes refuse the native shortcut, so we drive the
    // selection ourselves to guarantee parity with TiptapInput.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(host);
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      return;
    }

    if (event.key === "@") {
      // Let the character land in the editor, then mark the mention as
      // active.
      setTimeout(() => {
        const liveHost = ctx.host();
        if (!liveHost) return;
        const range = rangeInsideHost(liveHost);
        const offset = caretTextOffset(liveHost, range);
        ctx.setAtMention({
          active: true,
          startOffset: offset,
          hasAtChar: true,
        });
        ctx.getOnAtMention()?.("", caretCoords(liveHost));
      }, 0);
    }

    if (event.key === "/" && !ctx.getAtMention().active) {
      setTimeout(() => {
        const liveHost = ctx.host();
        if (!liveHost) return;
        const text = ctx.getText();
        if (ctx.slashTriggerMode === "command" && text !== "/") return;
        const range = rangeInsideHost(liveHost);
        const offset = caretTextOffset(liveHost, range);
        ctx.setSlashCommand({
          active: true,
          startOffset: offset,
          hasTriggerChar: true,
        });
        ctx.getOnSlashCommand()?.("", caretCoords(liveHost));
      }, 0);
    }

    if (
      event.key === "Enter" &&
      !ctx.getAtMention().active &&
      !ctx.getSlashCommand().active
    ) {
      if (ctx.requireCmdEnter) {
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          const text = ctx.getText();
          if (text.trim()) ctx.getOnSubmit()?.(text);
          return;
        }
        // Shift+Enter or bare Enter → newline. Notify the host first so the
        // expansion observer can swap layouts before the new line paints.
        ctx.getOnBeforeNewline()?.();
        event.preventDefault();
        ctx.insertNewline();
        return;
      }
      if (!event.shiftKey) {
        event.preventDefault();
        const text = ctx.getText();
        if (text.trim()) ctx.getOnSubmit()?.(text);
        return;
      }
      ctx.getOnBeforeNewline()?.();
      event.preventDefault();
      ctx.insertNewline();
      return;
    }

    if (event.key === "Escape" && ctx.getAtMention().active) {
      ctx.setAtMention({ active: false, startOffset: 0 });
      ctx.getOnAtMentionClose()?.();
      return;
    }
    if (event.key === "Escape" && ctx.getSlashCommand().active) {
      ctx.setSlashCommand({ active: false, startOffset: 0 });
      ctx.getOnSlashCommandClose()?.();
    }
  };
}
