/**
 * AIActionVisualizer Component
 *
 * Visual feedback overlay for AI-dispatched actions.
 * Shows highlight ring, cursor, and toast when AI performs actions.
 *
 * Features:
 * - Highlight ring around target element
 * - Animated AI cursor
 * - Action description toast
 * - Click/focus/highlight animations
 *
 * Usage:
 * 1. Mount <AIActionVisualizer /> in your app (renders via portal)
 * 2. Use getGlobalVisualizer().show({ targetSelector, description }) to trigger
 * 3. Call getGlobalVisualizer().hide() when done
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { AI_VISUALIZER_CONFIG } from "./config";
import "./index.scss";
import {
  clearGlobalVisualizer,
  setGlobalVisualizer,
  useAIActionVisualizer,
} from "./useAIActionVisualizer";

// ============================================
// Typewriter Component
// ============================================

interface TypewriterTextProps {
  text: string;
  /** Characters per second */
  speed?: number;
}

const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  speed = 40,
}) => {
  const [displayedText, setDisplayedText] = useState("");
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setDisplayedText("");
    setIsComplete(false);

    if (!text) return;

    let currentIndex = 0;
    const intervalMs = 1000 / speed;

    const timer = setInterval(() => {
      currentIndex++;
      if (currentIndex <= text.length) {
        setDisplayedText(text.slice(0, currentIndex));
      } else {
        setIsComplete(true);
        clearInterval(timer);
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [text, speed]);

  return (
    <span className="ai-action-toast-text">
      {displayedText}
      {!isComplete && <span className="ai-typing-cursor">|</span>}
    </span>
  );
};

// ============================================
// Component
// ============================================

export const AIActionVisualizer: React.FC = () => {
  const { state, updateTargetRect, controller } = useAIActionVisualizer();
  const [cursorPosition, setCursorPosition] = useState({ x: -100, y: -100 });
  const [isCursorVisible, setIsCursorVisible] = useState(false);
  const [isCursorAnimating, setIsCursorAnimating] = useState(false);

  // Register global controller on mount (controller ref is stable)
  useEffect(() => {
    setGlobalVisualizer(controller);
    return () => {
      clearGlobalVisualizer(controller);
    };
  }, [controller]);

  // Animate cursor from center of screen to target
  useEffect(() => {
    if (state.isActive && state.targetRect && state.showCursor) {
      const targetX = state.targetRect.left + state.targetRect.width / 2;
      const targetY = state.targetRect.top + state.targetRect.height / 2;

      // Start cursor from center of viewport
      const startX = window.innerWidth / 2;
      const startY = window.innerHeight / 2;

      // Use RAF to defer initial positioning (avoids lint warning about sync setState)
      const initFrame = requestAnimationFrame(() => {
        setCursorPosition({ x: startX, y: startY });
        setIsCursorVisible(true);
        setIsCursorAnimating(false);
      });

      // Then animate to target after a brief delay (let the cursor appear first)
      const moveTimer = setTimeout(() => {
        setIsCursorAnimating(true);
        setCursorPosition({ x: targetX, y: targetY });
      }, 100);

      // End animation state after transition completes (800ms animation)
      const endTimer = setTimeout(() => {
        setIsCursorAnimating(false);
      }, 900);

      return () => {
        cancelAnimationFrame(initFrame);
        clearTimeout(moveTimer);
        clearTimeout(endTimer);
      };
    } else {
      // Hide cursor when not active (use RAF to defer)
      const rafId = requestAnimationFrame(() => {
        setIsCursorVisible(false);
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [state.isActive, state.targetRect, state.showCursor]);

  // Update rect on scroll/resize
  useEffect(() => {
    if (!state.isActive) return;

    const handleUpdate = () => {
      updateTargetRect();
    };

    window.addEventListener("scroll", handleUpdate, true);
    window.addEventListener("resize", handleUpdate);

    return () => {
      window.removeEventListener("scroll", handleUpdate, true);
      window.removeEventListener("resize", handleUpdate);
    };
  }, [state.isActive, updateTargetRect]);

  // Don't render if not active
  if (!state.isActive) return null;

  const { targetRect, description, animationType, showCursor, showToast } =
    state;
  const padding = AI_VISUALIZER_CONFIG.highlightPadding;

  return createPortal(
    <div
      className="ai-action-visualizer"
      style={{ zIndex: AI_VISUALIZER_CONFIG.zIndex }}
    >
      {/* Highlight ring around target (only if we have a target) */}
      {targetRect && (
        <div
          className={`ai-action-highlight ai-action-highlight--${animationType}`}
          style={{
            top: targetRect.top - padding,
            left: targetRect.left - padding,
            width: targetRect.width + padding * 2,
            height: targetRect.height + padding * 2,
            borderRadius: AI_VISUALIZER_CONFIG.highlightBorderRadius,
          }}
        />
      )}

      {/* AI Cursor (only if visible and we have a target) */}
      {showCursor && targetRect && isCursorVisible && (
        <div
          className={`ai-cursor ${isCursorAnimating ? "ai-cursor--animating" : ""}`}
          style={{
            transform: `translate(${cursorPosition.x}px, ${cursorPosition.y}px)`,
          }}
        >
          {/* Cursor SVG */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            className="ai-cursor-icon"
          >
            <path
              d="M5.5 3.5L18.5 12L12 13.5L9 20.5L5.5 3.5Z"
              fill="var(--color-primary-6)"
              stroke="white"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <span className="ai-cursor-label">AI</span>
        </div>
      )}

      {/* Action toast with typewriter effect */}
      {showToast && description && (
        <div className="ai-action-toast">
          <span className="ai-action-toast-icon">✨</span>
          <TypewriterText text={description} speed={50} />
        </div>
      )}
    </div>,
    document.body
  );
};

// ============================================
// Exports
// ============================================

export default AIActionVisualizer;
export {
  getGlobalVisualizer,
  setGlobalVisualizer,
  useAIActionVisualizer,
} from "./useAIActionVisualizer";
export { AI_VISUALIZER_CONFIG } from "./config";
export type {
  AIActionVisualizerController,
  ShowConfig,
  VisualizerState,
} from "./types";
