/**
 * SpotlightShellChrome
 *
 * Low-level chrome for SpotlightShell: simple panel + optional portal +
 * backdrop + viewport-centered positioning + footer slot beneath the panel.
 *
 * This is a direct merge of the previous SelectorContainer + SpotlightPortal
 * layer. Only consumed by SpotlightShell; palettes never see this component.
 */
import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useOverlayLayer } from "@src/store/ui/overlayLayerAtom";

import { SPOTLIGHT_CONFIG } from "../constants";
import { SPOTLIGHT_STYLES } from "../styles";

// ============ TYPES ============

export interface SpotlightShellChromeProps {
  isOpen: boolean;
  onClose: () => void;
  asPortal: boolean;
  stopPropagation: boolean;
  width: number;
  footer: React.ReactNode;
  children: React.ReactNode;
}

// ============ COMPONENT ============

export const SpotlightShellChrome: React.FC<SpotlightShellChromeProps> = ({
  isOpen,
  onClose,
  asPortal,
  stopPropagation,
  width,
  footer,
  children,
}) => {
  const inputHostRef = useRef<HTMLDivElement | null>(null);

  useOverlayLayer(isOpen && asPortal);

  // Bubble-phase escape handler (portal mode only — non-portal callers
  // expect the parent's focus trap to own escape).
  useEffect(() => {
    if (!isOpen || !asPortal) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, asPortal, onClose]);

  if (!isOpen) return null;

  const refocusInput = () => {
    // Try to refocus the first input inside the panel (palettes own their
    // own inputRef; the shell can't hold a typed ref to it).
    setTimeout(() => {
      const input =
        inputHostRef.current?.querySelector<HTMLInputElement>("input");
      input?.focus();
    }, 0);
  };

  const handlePanelClick = (event: React.MouseEvent) => {
    if (stopPropagation) event.stopPropagation();
    refocusInput();
  };

  const panel = (
    <div ref={inputHostRef}>
      <div
        className="overflow-hidden rounded-2xl border border-border-2 bg-bg-2 shadow-xl"
        style={{
          width: "100%",
          maxWidth: `${width}px`,
        }}
        onClick={handlePanelClick}
      >
        {children}
      </div>
    </div>
  );

  const shell =
    footer != null ? (
      <div className="flex w-full flex-col gap-2">
        {panel}
        <div className="flex w-full justify-center" onClick={refocusInput}>
          {footer}
        </div>
      </div>
    ) : (
      panel
    );

  if (!asPortal) {
    return (
      <>
        <style>{SPOTLIGHT_STYLES}</style>
        {shell}
      </>
    );
  }

  return createPortal(
    <>
      <style>{SPOTLIGHT_STYLES}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: SPOTLIGHT_CONFIG.backdropZIndex,
        }}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.stopPropagation();
            onClose();
          }
        }}
      />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 h-12 bg-gradient-to-b from-bg-1/90 to-transparent"
        style={{
          zIndex: SPOTLIGHT_CONFIG.backdropZIndex,
          borderTopLeftRadius: "var(--border-radius-window)",
          borderTopRightRadius: "var(--border-radius-window)",
        }}
        aria-hidden
      />
      <div
        data-spotlight-container
        style={{
          position: "fixed",
          top: SPOTLIGHT_CONFIG.topOffset,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: SPOTLIGHT_CONFIG.containerZIndex,
          width: `min(${width}px, calc(100vw - 160px))`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {shell}
      </div>
    </>,
    document.body
  );
};

export default SpotlightShellChrome;
