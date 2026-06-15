import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export function isKeyboardActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function createKeyboardActivationHandler(action: () => void) {
  return (event: ReactKeyboardEvent) => {
    if (isKeyboardActivationKey(event.key)) {
      event.preventDefault();
      action();
    }
  };
}

export function getInteractiveTabIndex(disabled: boolean): number {
  return disabled ? -1 : 0;
}
