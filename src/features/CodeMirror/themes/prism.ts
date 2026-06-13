import type React from "react";

const cssVar = (name: string, fallback: string) => `var(${name}, ${fallback})`;

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
const foreground = cssVar("--cm-editor-foreground", "#24292e");
const background = cssVar("--cm-editor-background", "transparent");

export const codeMirrorPrismTheme: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': {
    color: foreground,
    background,
    textShadow: "none",
    fontFamily: "var(--cm-font-family)",
  },
  'pre[class*="language-"]': {
    color: foreground,
    background,
    textShadow: "none",
    fontFamily: "var(--cm-font-family)",
  },
  comment: { color: comment, fontStyle: "italic" },
  prolog: { color: comment },
  doctype: { color: comment },
  cdata: { color: comment },
  punctuation: { color: foreground },
  property: { color: func },
  tag: { color: tag },
  boolean: { color: constant },
  "class-name": { color: func },
  number: { color: variable },
  constant: { color: constant },
  symbol: { color: string },
  deleted: { color: deleted, backgroundColor: deletedBg },
  selector: { color: tag },
  attrName: { color: variable },
  string: { color: string },
  char: { color: string },
  builtin: { color: constant },
  inserted: { color: tag },
  operator: { color: variable },
  entity: { color: link },
  url: { color: link, textDecoration: "underline" },
  atrule: { color: keyword },
  attrValue: { color: string },
  keyword: { color: keyword },
  function: { color: func },
  className: { color: func },
  regex: { color: string },
  important: { color: keyword, fontWeight: "bold" },
  variable: { color: variable },
  bold: { color: func, fontWeight: "bold" },
  italic: { color: func, fontStyle: "italic" },
  namespace: { opacity: 0.7 },
  "maybe-class-name": { color: func },
  parameter: { color: variable },
  plain: { color: foreground },
  script: { color: foreground },
  "token.deleted": { color: deleted, backgroundColor: deletedBg },
  "token.inserted": { color: tag },
  "token.invalid": { color: invalid },
};
