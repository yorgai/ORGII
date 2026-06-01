import React, { useContext, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { SpotlightFooterActionContext } from "./footerActionContext";

/**
 * ShellFooterAction
 *
 * Portal used by palettes to inject a footer action pill (e.g. "Manage
 * Models", "Manage Keys") next to the keyboard-hints footer rendered by
 * SpotlightShell. If there is no SpotlightShell in the tree, renders
 * nothing — callers don't need to guard.
 *
 * Uses useSyncExternalStore so the portal target stays in sync with the
 * shell's host ref without any effect + setState dance.
 */
export interface ShellFooterActionProps {
  children: React.ReactNode;
}

const emptySubscribe = () => () => {};
const emptyGetSnapshot = () => null;

export const ShellFooterAction: React.FC<ShellFooterActionProps> = ({
  children,
}) => {
  const slot = useContext(SpotlightFooterActionContext);

  const target = useSyncExternalStore<HTMLDivElement | null>(
    slot?.subscribe ?? emptySubscribe,
    slot?.getSnapshot ?? emptyGetSnapshot,
    emptyGetSnapshot
  );

  if (!target) return null;
  return createPortal(children, target);
};

export default ShellFooterAction;
