/**
 * CodeMirror Go to Line Extension
 *
 * Provides a Ctrl+G keyboard shortcut to open a panel
 * for navigating to a specific line number.
 */
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { EditorView, showPanel } from "@codemirror/view";

import { createGoToLinePanel } from "./GoToLinePanel";

const showGoToLinePanelEffect = StateEffect.define<null>();
const closeGoToLinePanelEffect = StateEffect.define<null>();
const toggleGoToLinePanelEffect = StateEffect.define<null>();

export function openGoToLinePanel(view: EditorView): boolean {
  view.dispatch({
    effects: [showGoToLinePanelEffect.of(null)],
  });
  return true;
}

export function toggleGoToLinePanel(view: EditorView): boolean {
  view.dispatch({
    effects: [toggleGoToLinePanelEffect.of(null)],
  });
  return true;
}

const goToLinePanelState = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(showGoToLinePanelEffect)) return true;
      if (effect.is(closeGoToLinePanelEffect)) return false;
      if (effect.is(toggleGoToLinePanelEffect)) return !value;
    }
    return value;
  },
  provide: (field) =>
    showPanel.from(field, (on) =>
      on
        ? (view) =>
            createGoToLinePanel(view, () => {
              view.dispatch({
                effects: [closeGoToLinePanelEffect.of(null)],
              });
              view.focus();
            })
        : null
    ),
});

/**
 * Go to line extension with Ctrl+G keyboard shortcut
 */
export function goToLineExtension(): Extension {
  return [
    goToLinePanelState,
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.ctrlKey && !event.metaKey && event.key === "g") {
          event.preventDefault();
          toggleGoToLinePanel(view);
          return true;
        }
        return false;
      },
    }),
  ];
}
