import type { JSONContent } from "@tiptap/react";

import type { PillIconType } from "@src/components/ComposerInput";

export interface RichTextEditorRef {
  getText: () => string;
  getHTML: () => string;
  getJSON: () => JSONContent | undefined;
  getMarkdown: () => string;
  setContent: (content: string | JSONContent) => void;
  clear: () => void;
  focus: () => void;
  isEmpty: () => boolean;
  insertImage: (src: string, alt?: string) => void;
  /** Insert a file pill */
  insertFilePill: (
    filePath: string,
    isFolder?: boolean,
    iconType?: PillIconType,
    displayName?: string
  ) => void;
  /** Remove a file pill by path */
  removeFilePill: (filePath: string) => void;
  /** Get all file pills in the editor */
  getFilePills: () => Array<{ filePath: string; fileName: string }>;
  /** Trigger @ mention mode manually */
  triggerAtMention: () => void;
}

export interface RichTextEditorProps {
  placeholder?: string;
  initialContent?: string | JSONContent;
  onContentChange?: (html: string, text: string, json: JSONContent) => void;
  /** Callback when images are pasted or dropped into the editor */
  onImageInsert?: (files: File[]) => void;
  /** Callback when @ is typed (for mention dropdown) */
  onAtMention?: (
    query: string,
    cursorPosition: { x: number; y: number }
  ) => void;
  /** Callback when @ mention is closed */
  onAtMentionClose?: () => void;
  autoFocus?: boolean;
  className?: string;
  toolbarClassName?: string;
  minHeight?: number;
  maxHeight?: number | string;
  editable?: boolean;
  /** Keyboard event handler for dropdown navigation - returns true if handled */
  onKeyDownForDropdown?: (event: KeyboardEvent) => boolean;
}

export interface AtMentionState {
  active: boolean;
  startPos: number;
  /**
   * `true` when the trigger was a typed "@" key (the character lives in the
   * document at `startPos - 1`). `false`/undefined for programmatic
   * triggers via `triggerAtMention()`, where no "@" was inserted.
   */
  hasAtChar?: boolean;
}
