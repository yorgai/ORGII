/**
 * SpotlightFormShell + SpotlightFormBody
 *
 * Shared chrome for every spotlight modal form (clone, import, create
 * repo/folder, create-workspace). All eight forms previously hand-rolled
 * the same wrapper structure (rounded panel containing a `p-3` body and a
 * `PanelFooter`); these two components are the single source of truth for
 * that layout.
 *
 * Usage:
 *
 *   <SpotlightFormShell>
 *     <SpotlightFormBody>
 *       {/* fields, lists, etc. *\/}
 *     </SpotlightFormBody>
 *     <PanelFooter ... />
 *   </SpotlightFormShell>
 */
import React from "react";

import { SPOTLIGHT_MODAL_FORM_TOKENS } from "./spotlightModalFormTokens";

interface SpotlightFormShellProps {
  children: React.ReactNode;
}

/**
 * Outer panel that visually separates the form from the surrounding
 * spotlight glass container. The background comes from
 * `SPOTLIGHT_MODAL_FORM_TOKENS`; padding is left to `SpotlightFormBody`
 * and `PanelFooter` so each section can manage its own spacing semantics.
 */
export const SpotlightFormShell: React.FC<SpotlightFormShellProps> = ({
  children,
}) => (
  <div className={SPOTLIGHT_MODAL_FORM_TOKENS.shellClassName}>{children}</div>
);

interface SpotlightFormBodyProps {
  children: React.ReactNode;
}

/**
 * Standard body region for a form panel. Applies the canonical `p-3`
 * inset so the body and the `PanelFooter` (`px-3 h-12`) line up on the
 * horizontal axis.
 */
export const SpotlightFormBody: React.FC<SpotlightFormBodyProps> = ({
  children,
}) => <div className="p-3">{children}</div>;
