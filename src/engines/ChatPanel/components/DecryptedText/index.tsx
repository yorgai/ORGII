/**
 * DecryptedText Component
 *
 * Renders text with a decryption animation effect where characters
 * scramble and gradually reveal the actual text.
 */
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import "./index.scss";

interface DecryptedTextProps {
  /** The text to display with decryption effect */
  text: string;
  /** Speed of character reveal in milliseconds (default: 30) */
  speed?: number;
  /** Characters to use for scrambling effect */
  scrambleChars?: string;
  /** Whether animation is enabled (default: true) */
  enabled?: boolean;
  /** Callback when animation completes */
  onComplete?: () => void;
  /** Custom className */
  className?: string;
}

const DEFAULT_SCRAMBLE_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

const DecryptedText: React.FC<DecryptedTextProps> = ({
  text,
  speed = 30,
  scrambleChars = DEFAULT_SCRAMBLE_CHARS,
  enabled = true,
  onComplete,
  className = "",
}) => {
  const [displayedText, setDisplayedText] = useState("");
  const [revealedCount, setRevealedCount] = useState(0);
  const animationRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const previousTextRef = useRef<string>("");

  const getRandomChar = useCallback(() => {
    return scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
  }, [scrambleChars]);

  // Reset animation when text changes
  useLayoutEffect(() => {
    if (!enabled) {
      // Use requestAnimationFrame to avoid synchronous setState in effect
      requestAnimationFrame(() => {
        setDisplayedText(text);
        setRevealedCount(text.length);
      });
      return;
    }

    // Check if this is new text (not just an update)
    if (text !== previousTextRef.current) {
      previousTextRef.current = text;

      // Only reset if text is longer (new content being streamed)
      if (text.length > revealedCount) {
        // Don't reset revealed count - keep what's already revealed
      } else if (text.length < revealedCount) {
        // Text got shorter - reset
        // Use requestAnimationFrame to avoid synchronous setState in effect
        requestAnimationFrame(() => {
          setRevealedCount(0);
        });
      }
    }
  }, [text, enabled, revealedCount]);

  // Animation loop
  useEffect(() => {
    if (!enabled || !text) {
      return;
    }

    const animate = (currentTime: number) => {
      // Check if enough time has passed since last update
      if (currentTime - lastUpdateRef.current >= speed) {
        lastUpdateRef.current = currentTime;

        setRevealedCount((prev) => {
          if (prev >= text.length) {
            onComplete?.();
            return prev;
          }
          return prev + 1;
        });
      }

      // Build displayed text: revealed chars + scrambled remaining
      setDisplayedText((_prevDisplayed) => {
        // Get current revealed count from state
        const currentRevealed = Math.min(revealedCount, text.length);
        const revealed = text.slice(0, currentRevealed);
        const remaining = text.slice(currentRevealed);

        // Scramble remaining characters (preserve spaces and newlines)
        const scrambled = remaining
          .split("")
          .map((char) => {
            if (char === " " || char === "\n" || char === "\t") {
              return char;
            }
            return getRandomChar();
          })
          .join("");

        return revealed + scrambled;
      });

      if (revealedCount < text.length) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [text, speed, enabled, revealedCount, getRandomChar, onComplete]);

  // When animation is complete, ensure we show the final text
  useLayoutEffect(() => {
    if (revealedCount >= text.length && text.length > 0) {
      // Use requestAnimationFrame to avoid synchronous setState in effect
      requestAnimationFrame(() => {
        setDisplayedText(text);
      });
    }
  }, [revealedCount, text]);

  if (!enabled) {
    return <span className={className}>{text}</span>;
  }

  return <span className={`decrypted-text ${className}`}>{displayedText}</span>;
};

export default DecryptedText;
