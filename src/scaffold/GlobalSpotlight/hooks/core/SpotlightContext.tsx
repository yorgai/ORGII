/**
 * Spotlight Context - Provider and Hooks
 *
 * Provides spotlight state and dispatch throughout the component tree.
 */
import React, { createContext, useContext, useReducer } from "react";

import { initialSpotlightState, spotlightReducer } from "./spotlightReducer";
import type { SpotlightAction, SpotlightState } from "./types";

// ============================================
// Context Definition
// ============================================

interface SpotlightContextValue {
  state: SpotlightState;
  dispatch: React.Dispatch<SpotlightAction>;
}

const SpotlightContext = createContext<SpotlightContextValue | null>(null);

// ============================================
// Provider Component
// ============================================

interface SpotlightProviderProps {
  children: React.ReactNode;
  initialState?: Partial<SpotlightState>;
}

export function SpotlightProvider({
  children,
  initialState,
}: SpotlightProviderProps): React.ReactElement {
  const [state, dispatch] = useReducer(
    spotlightReducer,
    initialState
      ? { ...initialSpotlightState, ...initialState }
      : initialSpotlightState
  );

  return (
    <SpotlightContext.Provider value={{ state, dispatch }}>
      {children}
    </SpotlightContext.Provider>
  );
}

// ============================================
// Hooks
// ============================================

/**
 * Access spotlight state and dispatch
 */
export function useSpotlightContext(): SpotlightContextValue {
  const context = useContext(SpotlightContext);
  if (!context) {
    throw new Error(
      "useSpotlightContext must be used within SpotlightProvider"
    );
  }
  return context;
}

/**
 * Access only spotlight state (for read-only components)
 */
export function useSpotlightState(): SpotlightState {
  return useSpotlightContext().state;
}

/**
 * Access only dispatch (stable reference, never changes)
 */
export function useSpotlightDispatch(): React.Dispatch<SpotlightAction> {
  return useSpotlightContext().dispatch;
}
