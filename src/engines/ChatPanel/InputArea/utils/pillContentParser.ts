import { PILL_REGEX, type PillType } from "@src/config/pillTokens";

interface TiptapNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
}

interface TiptapParagraph {
  type: "paragraph";
  content?: TiptapNode[];
}

export interface TiptapDoc {
  type: "doc";
  content: TiptapParagraph[];
}

export function parseContentToTiptapJson(text: string): TiptapDoc {
  const lines = text.split("\n");
  const paragraphs: TiptapParagraph[] = lines.map((line) => {
    const nodes: TiptapNode[] = [];
    let lastIndex = 0;

    for (const match of line.matchAll(PILL_REGEX)) {
      const matchStart = match.index;
      if (matchStart === undefined) continue;

      if (matchStart > lastIndex) {
        nodes.push({ type: "text", text: line.slice(lastIndex, matchStart) });
      }

      const displayName = match[1].trim();
      const pillType = match[2] as PillType;
      const path = match[3];

      nodes.push({
        type: "filePill",
        attrs: {
          filePath: path,
          fileName: displayName,
          isFolder: pillType === "folder",
          iconType: pillType,
          lineStart: null,
          lineEnd: null,
        },
      });

      lastIndex = matchStart + match[0].length;
    }

    if (lastIndex < line.length) {
      nodes.push({ type: "text", text: line.slice(lastIndex) });
    }

    return nodes.length > 0
      ? { type: "paragraph", content: nodes }
      : { type: "paragraph" };
  });

  return { type: "doc", content: paragraphs };
}

export function hasPillSyntax(text: string): boolean {
  return text.match(PILL_REGEX) !== null;
}

/**
 * Calls `setContent` on any editor handle that exposes it, automatically
 * parsing pill-serialized text back into TipTap JSON nodes when needed.
 * Using this instead of calling setContent directly avoids duplicating the
 * hasPillSyntax → parseContentToTiptapJson → setContent branch everywhere.
 */
export function applyParsedContent(
  editor: { setContent: (content: string) => void },
  content: string
) {
  if (hasPillSyntax(content)) {
    // TipTap's setContent also accepts a JSONContent object at runtime even
    // though the local interface only declares string — cast to satisfy TS.
    editor.setContent(parseContentToTiptapJson(content) as unknown as string);
  } else {
    editor.setContent(content);
  }
}
