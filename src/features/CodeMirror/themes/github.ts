/**
 * GitHub Theme for CodeMirror 6
 *
 * Integrated with token system for user customization.
 * Syntax colors are defined as CSS variables in the active public theme CSS
 * and referenced directly so theme swaps update the editor without JS copies.
 *
 * Original source: https://github.com/uiwjs/react-codemirror/tree/master/themes/github
 */
import { tags as t } from "@lezer/highlight";
import { createTheme } from "@uiw/codemirror-themes";

function cssVar(name: string, fallback: string): string {
  return `var(${name}, ${fallback})`;
}

/**
 * Creates a GitHub-style theme using public CSS variable tokens.
 */
export function createGithubTheme(): ReturnType<typeof createTheme> {
  const settings = {
    background: cssVar("--cm-editor-background", "#fff"),
    foreground: cssVar("--cm-editor-foreground", "#24292e"),
    selection: cssVar("--cm-editor-selection", "var(--color-fill-2)"),
    selectionMatch: cssVar("--cm-editor-selection", "var(--color-fill-2)"),
    gutterBackground: cssVar("--cm-editor-gutter-bg", "#fff"),
    gutterForeground: cssVar("--cm-editor-gutter-fg", "#6e7781"),
    lineHighlight: cssVar("--cm-editor-line-highlight", "transparent"),
  };

  const keyword = cssVar("--cm-syntax-keyword", "#d73a49");
  const string = cssVar("--cm-syntax-string", "#032f62");
  const comment = cssVar("--cm-syntax-comment", "#6a737d");
  const func = cssVar("--cm-syntax-function", "#6f42c1");
  const variable = cssVar("--cm-syntax-variable", "#005cc5");
  const tag = cssVar("--cm-syntax-tag", "#116329");
  const constant = cssVar("--cm-syntax-constant", "#e36209");
  const link = cssVar("--cm-syntax-link", "#032f62");
  const invalid = cssVar("--cm-syntax-invalid", "#cb2431");
  const deleted = cssVar("--cm-syntax-deleted", "#b31d28");
  const deletedBg = cssVar("--cm-syntax-deleted-bg", "#ffeef0");

  const styles = [
    { tag: [t.standard(t.tagName), t.tagName], color: tag },
    { tag: [t.comment, t.bracket], color: comment },
    { tag: [t.className, t.propertyName], color: func },
    {
      tag: [t.variableName, t.attributeName, t.number, t.operator],
      color: variable,
    },
    { tag: [t.keyword, t.typeName, t.typeOperator], color: keyword },
    { tag: [t.string, t.meta, t.regexp], color: string },
    { tag: [t.name, t.quote], color: tag },
    { tag: [t.heading, t.strong], color: func, fontWeight: "bold" },
    { tag: [t.emphasis], color: func, fontStyle: "italic" },
    { tag: [t.deleted], color: deleted, backgroundColor: deletedBg },
    { tag: [t.atom, t.bool, t.special(t.variableName)], color: constant },
    { tag: [t.url, t.escape, t.regexp, t.link], color: link },
    { tag: t.link, textDecoration: "underline" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.invalid, color: invalid },
  ];

  return createTheme({
    theme: "light",
    settings,
    styles,
  });
}
