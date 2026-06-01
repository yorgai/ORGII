/**
 * FilePill Node Extension for Tiptap
 *
 * Creates an atomic inline node for file/folder pills in the editor.
 * The node is non-editable - cursor navigates around it, not inside it.
 *
 * This solves the stale selection/highlighter issues with raw contentEditable.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import FilePillNodeView from "./FilePillNodeView";
import type { PillIconType } from "./types";

// Re-export PillIconType for consumers
export type { PillIconType } from "./types";

export interface FilePillOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    filePill: {
      /**
       * Insert a file pill at the current selection
       */
      insertFilePill: (options: {
        filePath: string;
        fileName: string;
        isFolder?: boolean;
        /** Icon type for special items (terminal, session, browser) */
        iconType?: PillIconType;
        /** Start line number for file reference */
        lineStart?: number;
        /** End line number for file reference */
        lineEnd?: number;
      }) => ReturnType;
      /**
       * Remove a file pill by path
       */
      removeFilePill: (filePath: string) => ReturnType;
    };
  }
}

export const FilePillNode = Node.create<FilePillOptions>({
  name: "filePill",

  group: "inline",

  inline: true,

  // CRITICAL: Makes the node atomic - cursor cannot be placed inside
  atom: true,

  // Don't allow selection inside the node
  selectable: true,

  // Can be dragged
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      filePath: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-file-path"),
        renderHTML: (attributes) => ({
          "data-file-path": attributes.filePath,
        }),
      },
      fileName: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-file-name"),
        renderHTML: (attributes) => ({
          "data-file-name": attributes.fileName,
        }),
      },
      isFolder: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-is-folder") === "true",
        renderHTML: (attributes) => ({
          "data-is-folder": String(attributes.isFolder),
        }),
      },
      iconType: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-icon-type"),
        renderHTML: (attributes) => ({
          "data-icon-type": attributes.iconType,
        }),
      },
      lineStart: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-line-start");
          return value ? parseInt(value, 10) : null;
        },
        renderHTML: (attributes) => ({
          "data-line-start": attributes.lineStart,
        }),
      },
      lineEnd: {
        default: null,
        parseHTML: (element) => {
          const value = element.getAttribute("data-line-end");
          return value ? parseInt(value, 10) : null;
        },
        renderHTML: (attributes) => ({
          "data-line-end": attributes.lineEnd,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-type="file-pill"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        { "data-type": "file-pill", class: "file-pill" },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      HTMLAttributes.fileName || "",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FilePillNodeView);
  },

  addCommands() {
    return {
      insertFilePill:
        (options) =>
        ({ commands, editor: _editor }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              filePath: options.filePath,
              fileName: options.fileName,
              isFolder: options.isFolder || false,
              iconType: options.iconType || null,
              lineStart: options.lineStart ?? null,
              lineEnd: options.lineEnd ?? null,
            },
          });
        },
      removeFilePill:
        (filePath) =>
        ({ editor, tr }) => {
          const { doc } = editor.state;
          let deleted = false;

          doc.descendants((node, pos) => {
            if (
              node.type.name === this.name &&
              node.attrs.filePath === filePath
            ) {
              tr.delete(pos, pos + node.nodeSize);
              deleted = true;
              return false; // Stop traversal after first match
            }
          });

          return deleted;
        },
    };
  },

  // Handle keyboard shortcuts
  addKeyboardShortcuts() {
    return {
      // Backspace deletes the pill if cursor is right after it
      Backspace: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;

        // Check if the node before cursor is a filePill
        const nodeBefore = $from.nodeBefore;
        if (nodeBefore?.type.name === this.name) {
          return this.editor.commands.deleteRange({
            from: $from.pos - nodeBefore.nodeSize,
            to: $from.pos,
          });
        }

        return false;
      },
      // Delete key deletes the pill if cursor is right before it
      Delete: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;

        // Check if the node after cursor is a filePill
        const nodeAfter = $from.nodeAfter;
        if (nodeAfter?.type.name === this.name) {
          return this.editor.commands.deleteRange({
            from: $from.pos,
            to: $from.pos + nodeAfter.nodeSize,
          });
        }

        return false;
      },
    };
  },
});

export default FilePillNode;
