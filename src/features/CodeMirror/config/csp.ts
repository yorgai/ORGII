import { EditorView } from "@codemirror/view";

export const CODEMIRROR_STYLE_NONCE = "orgii-codemirror-style";

export const codeMirrorCspNonceExtension = EditorView.cspNonce.of(
  CODEMIRROR_STYLE_NONCE
);
