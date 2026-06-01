/**
 * AppProviders
 *
 * Outermost React context layer. Wraps the entire app with:
 * - Jotai `Provider` backed by an instrumented store (DevTools-aware atom tracking)
 * - `WindowStateProvider` — scopes per-window Jotai atoms so multi-window
 *   Tauri instances each get their own isolated state namespace
 *
 * Mounted once in main.tsx above AppBootstrap. Nothing else should add
 * global providers here; use the appropriate context location instead.
 */
import { Provider } from "jotai";
import React, { useMemo } from "react";

import { createInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { WindowStateProvider } from "@src/util/core/state/windowScopedState";

export const AppProviders: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const instrumentedStore = useMemo(() => createInstrumentedStore(), []);

  return (
    <Provider store={instrumentedStore}>
      <WindowStateProvider>{children}</WindowStateProvider>
    </Provider>
  );
};
