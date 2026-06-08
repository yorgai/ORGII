# Test Cases: ComposerInput Cut Behaviour

## Preconditions

- The ComposerInput is mounted and focusable.
- At least one pill (file, folder, terminal, skill, etc.) is present in the editor.
- The user can interact via keyboard (Cmd+X on macOS, Ctrl+X on Windows/Linux).

## Happy Path

| #   | Steps                                                                                             | Expected Result                                                                      |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Type "hello world". Select "world". Press Cmd+X.                                                  | "world" is removed from the editor; clipboard plain text = "world".                  |
| 2   | Insert a file pill, then type " is important". Select all (Cmd+A). Press Cmd+X.                   | Editor is empty; clipboard plain text = `"<fileName> is important"`.                 |
| 3   | Type "see ", insert a pill, type " for details". Select the pill + surrounding text. Press Cmd+X. | Selected content removed; clipboard plain text contains pill display name inline.    |
| 4   | Cut content from step 3. Press Cmd+V in the same editor.                                          | Full content (text + pill with original metadata) is restored at the caret.          |
| 5   | Cut a selection containing a file pill. Paste into a plain-text field (e.g. Terminal).            | Only the plain-text display name (e.g. `"index.tsx"`) appears — no JSON or metadata. |

## Edge Cases

| #   | Scenario                           | Steps                                                                         | Expected Result                                                                                      |
| --- | ---------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | No selection                       | Place caret without selecting anything. Press Cmd+X.                          | Nothing is cut; editor content unchanged; no clipboard write.                                        |
| 2   | Multiple pills selected            | Select a range spanning two or more pills. Press Cmd+X.                       | All pills in range removed; clipboard contains all pill display names in order.                      |
| 3   | Entire editor selected             | Press Cmd+A then Cmd+X.                                                       | Editor becomes empty (placeholder shown); clipboard contains full content.                           |
| 4   | Pill at selection boundary (start) | Place selection start just before a pill, end mid-text. Press Cmd+X.          | Pill and text after it are cut; preceding text preserved.                                            |
| 5   | Pill at selection boundary (end)   | Place selection start mid-text, end just after a pill. Press Cmd+X.           | Text before pill and pill are cut.                                                                   |
| 6   | Multi-line content with pills      | Editor has two lines each with a pill. Select across line break. Press Cmd+X. | Newline preserved in clipboard plain text; both pills serialized.                                    |
| 7   | Rapid cut–paste–cut cycle          | Quickly Cmd+X, Cmd+V, Cmd+X.                                                  | Each operation leaves editor and clipboard in a consistent state; no duplicate pills or ghost spans. |
| 8   | Cut inside IME composition         | Begin CJK input, cut mid-composition.                                         | Composition is committed; cut operates on committed text.                                            |

## Error / Degraded States

| #   | Scenario                                 | Steps                                                           | Expected Result                                            |
| --- | ---------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | Clipboard API unavailable                | Block `ClipboardEvent.clipboardData` in dev tools. Press Cmd+X. | Handler exits silently; browser default runs; no JS error. |
| 2   | Fragment JSON malformed on paste         | Manually set clipboard MIME to invalid JSON, then paste.        | Falls through to plain-text paste; no JS error thrown.     |
| 3   | Editor not editable (`editable={false}`) | Render with `editable={false}`, try Cmd+X.                      | Browser blocks input; no state mutation.                   |

## Accessibility

- [x] Keyboard-navigable (Cmd+X / Ctrl+X trigger the custom handler)
- [x] Screen reader: pills are `contenteditable="false"` spans; standard cut removes them as expected
- [ ] Focus trap not applicable (ComposerInput is an inline editor, not a modal)

## Acceptance Criteria

- [x] Selecting text + pills and pressing Cmd+X removes all selected content from the editor
- [x] The OS clipboard receives a plain-text representation (pills as display names)
- [x] The OS clipboard receives an `application/x-orgii-composer-fragment` payload with full pill metadata
- [x] Pasting the cut content back into ComposerInput restores pills with their original attributes
- [x] Pasting into an external app (e.g. Notes, Terminal) produces only readable plain text
- [x] When nothing is selected, Cmd+X is a no-op
- [x] `pnpm test` passes with no new failures
- [x] No TypeScript errors (`npx tsc --noEmit` exits 0)
