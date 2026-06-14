import { atom } from "jotai";

import type { CustomMentionOption } from "@src/engines/ChatPanel/hooks/useInputArea/types";
import { mainPaneTabsAtom } from "@src/store/workstation/tabs";

import { getOpenedTabMentionOptions } from "./openedTabMentionOptions";

function sameMentionOptions(
  left: readonly CustomMentionOption[],
  right: readonly CustomMentionOption[]
): boolean {
  if (left.length !== right.length) return false;
  return left.every((leftOption, index) => {
    const rightOption = right[index];
    return (
      rightOption !== undefined &&
      leftOption.id === rightOption.id &&
      leftOption.label === rightOption.label &&
      leftOption.description === rightOption.description &&
      leftOption.selectType === rightOption.selectType &&
      leftOption.selectValue === rightOption.selectValue &&
      leftOption.selectDisplayName === rightOption.selectDisplayName
    );
  });
}

export const openedTabMentionOptionsAtom = (() => {
  let previousOptions: CustomMentionOption[] = [];

  return atom<CustomMentionOption[]>((get) => {
    const nextOptions = getOpenedTabMentionOptions(get(mainPaneTabsAtom));
    if (sameMentionOptions(previousOptions, nextOptions)) {
      return previousOptions;
    }
    previousOptions = nextOptions;
    return previousOptions;
  });
})();

openedTabMentionOptionsAtom.debugLabel = "openedTabMentionOptionsAtom";
