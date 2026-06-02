import type {
  ComposerPillAttrs,
  ComposerSnapshot,
} from "@src/components/ComposerInput/types";
import { PILL_REGEX, type PillType } from "@src/config/pillTokens";

/**
 * Separator injected by `pill_resolver.rs` when expanding pill references.
 * The backend appends this block to the user message before sending to the LLM,
 * so it gets stored in the DB as part of `display_text`. We must strip it when
 * loading into the edit editor so the user only sees their original message.
 */
const PILL_EXPANSION_SEPARATOR =
  "\n\n---\n**Referenced content (auto-expanded):**";

/**
 * Strips the auto-expanded pill content appended by the Rust `pill_resolver`.
 * Returns the original user message (everything before the separator).
 */
export function stripExpandedPillContent(text: string): string {
  const idx = text.indexOf(PILL_EXPANSION_SEPARATOR);
  return idx === -1 ? text : text.slice(0, idx);
}

export function hasPillSyntax(text: string): boolean {
  return text.match(PILL_REGEX) !== null;
}

/**
 * Parses pill-serialized text (e.g. `filename [file:path]`) into a
 * `ComposerSnapshot` understood by `ComposerInputRef.setContent`. Each
 * newline becomes a `newline` part so multi-line content round-trips correctly.
 */
export function parsePillTextToSnapshot(text: string): ComposerSnapshot {
  const parts: ComposerSnapshot["parts"] = [];
  const lines = text.split("\n");

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) parts.push({ kind: "newline" });

    let lastIndex = 0;
    for (const match of line.matchAll(PILL_REGEX)) {
      const matchStart = match.index;
      if (matchStart === undefined) continue;

      if (matchStart > lastIndex) {
        parts.push({ kind: "text", text: line.slice(lastIndex, matchStart) });
      }

      const fileName = match[1].trim();
      const pillType = match[2] as PillType;
      const filePath = match[3];

      const attrs: ComposerPillAttrs = {
        filePath,
        fileName,
        isFolder: pillType === "folder",
        iconType: pillType,
        lineStart: null,
        lineEnd: null,
      };
      parts.push({ kind: "pill", attrs });

      lastIndex = matchStart + match[0].length;
    }

    if (lastIndex < line.length) {
      parts.push({ kind: "text", text: line.slice(lastIndex) });
    }
  });

  return { parts };
}

/**
 * Calls `setContent` on a `ComposerInputRef`, parsing pill-serialized text
 * back into a `ComposerSnapshot` (with pill parts) when pill syntax is present.
 */
export function applyParsedContent(
  editor: { setContent: (content: string | ComposerSnapshot) => void },
  content: string
) {
  if (hasPillSyntax(content)) {
    editor.setContent(parsePillTextToSnapshot(content));
  } else {
    editor.setContent(content);
  }
}
