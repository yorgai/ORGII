/**
 * SpotlightShellChrome
 *
 * Low-level chrome for SpotlightShell: Glass panel + optional portal +
 * backdrop + sidebar-aware centering + footer slot beneath the panel.
 *
 * This is a direct merge of the previous SelectorContainer + SpotlightPortal
 * layer. Only consumed by SpotlightShell; palettes never see this component.
 */
import { useAtomValue } from "jotai";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

import Glass from "@src/components/Glass";
import type { MaterialThickness } from "@src/components/Glass/config";
import { hasSidebar } from "@src/config/sidebarRegistry";
import { useOverlayLayer } from "@src/store/ui/overlayLayerAtom";
import {
  sidebarCollapsedAtom,
  sidebarWidthAtom,
} from "@src/store/ui/sidebarAtom";

import { SPOTLIGHT_CONFIG, SPOTLIGHT_GLASS_PANEL_CLASS } from "../constants";
import { SPOTLIGHT_STYLES } from "../styles";

// ============ TYPES ============

export interface SpotlightShellChromeProps {
  isOpen: boolean;
  onClose: () => void;
  asPortal: boolean;
  stopPropagation: boolean;
  width: number;
  material: MaterialThickness;
  footer: React.ReactNode;
  children: React.ReactNode;
}

// ============ POSITION HOOK ============

function useSidebarAwarePosition(isOpen: boolean, asPortal: boolean) {
  const [left, setLeft] = useState<string | number>("50%");
  const [isReady, setIsReady] = useState(false);
  const isCollapsed = useAtomValue(sidebarCollapsedAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const location = useLocation();

  const calc = useCallback(() => {
    if (!asPortal) return "50%";
    let offset = 0;
    if (hasSidebar(location.pathname) && !isCollapsed) {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      if (isMac) offset = sidebarWidth;
    }
    const vw = window.innerWidth;
    return offset + (vw - offset) / 2;
  }, [asPortal, isCollapsed, sidebarWidth, location.pathname]);

  useLayoutEffect(() => {
    if (!isOpen) {
      requestAnimationFrame(() => setIsReady(false));
      return;
    }
    const update = () => {
      setLeft(calc());
      requestAnimationFrame(() => setIsReady(true));
    };
    update();
    if (asPortal) {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
  }, [isOpen, asPortal, calc]);

  return { left, isReady };
}

// ============ COMPONENT ============

export const SpotlightShellChrome: React.FC<SpotlightShellChromeProps> = ({
  isOpen,
  onClose,
  asPortal,
  stopPropagation,
  width,
  material,
  footer,
  children,
}) => {
  const { left } = useSidebarAwarePosition(isOpen, asPortal);
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
      <Glass
        material={material}
        className={SPOTLIGHT_GLASS_PANEL_CLASS}
        style={{
          width: "100%",
          maxWidth: `${width}px`,
        }}
        radius={16}
        enableSpecular={true}
        onClick={handlePanelClick}
      >
        {children}
      </Glass>
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
        data-spotlight-container
        style={{
          position: "fixed",
          top: SPOTLIGHT_CONFIG.topOffset,
          left,
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
