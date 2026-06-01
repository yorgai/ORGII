/**
 * useDesignTokens - Hook for managing design tokens in component preview
 *
 * Features:
 * - Auto-extracts tokens from component files via Rust
 * - Leaves values empty until users provide or extraction supplies them
 * - Allows manual token additions
 * - Generates CSS for injection into preview
 */
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import { getTokenValue, isKnownToken } from "@src/config/designTokens";

// ============================================
// Types
// ============================================

export interface TokenInfo {
  /** Token name (without -- prefix) */
  name: string;
  /** Current value */
  value: string;
  /** Whether this token was auto-detected from the component */
  autoDetected: boolean;
  /** Whether this token has built-in metadata */
  isKnown: boolean;
  /** Whether the user has customized this token */
  customized: boolean;
}

export interface TokenExtractionResult {
  tokens: string[];
  usage_count: number;
}

export interface UseDesignTokensOptions {
  /** Initial theme */
  theme?: "light" | "dark";
  /** File path to extract tokens from */
  filePath?: string;
  /** Additional file paths (e.g., project file) */
  additionalPaths?: string[];
}

export interface UseDesignTokensReturn {
  /** All tokens (auto-detected + manual) */
  tokens: TokenInfo[];
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Current theme */
  theme: "light" | "dark";
  /** Set theme */
  setTheme: (theme: "light" | "dark") => void;
  /** Add a token manually */
  addToken: (name: string, value?: string) => void;
  /** Remove a token */
  removeToken: (name: string) => void;
  /** Update a token's value */
  updateToken: (name: string, value: string) => void;
  /** Reset a token to default value */
  resetToken: (name: string) => void;
  /** Generate CSS for all tokens */
  generateCSS: () => string;
  /** Re-extract tokens from file */
  refresh: () => Promise<void>;
}

// ============================================
// Hook
// ============================================

export function useDesignTokens(
  options: UseDesignTokensOptions = {}
): UseDesignTokensReturn {
  const {
    theme: initialTheme = "light",
    filePath,
    additionalPaths = [],
  } = options;

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [_customValues, setCustomValues] = useState<Record<string, string>>({});

  /**
   * Extract tokens from file(s)
   */
  const extractTokens = useCallback(async () => {
    if (!filePath) return;

    setLoading(true);
    setError(null);

    try {
      const paths = [filePath, ...additionalPaths];
      const result = await invoke<TokenExtractionResult>(
        "extract_tokens_from_files",
        { filePaths: paths }
      );

      // Convert to TokenInfo array
      // Note: We read customValues via setState callback to avoid dependency
      setTokens((prevTokens) => {
        // Build a map of previous custom values from existing tokens
        const prevCustom: Record<string, string> = {};
        for (const token of prevTokens) {
          if (token.customized) {
            prevCustom[token.name] = token.value;
          }
        }

        return result.tokens.map((name) => {
          const isKnown = isKnownToken(name);
          const defaultValue = getTokenValue(name, theme);
          const customValue = prevCustom[name];

          return {
            name,
            value: customValue ?? defaultValue ?? "",
            autoDetected: true,
            isKnown,
            customized: !!customValue,
          };
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[useDesignTokens] Extraction failed:", message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [filePath, additionalPaths, theme]);

  /**
   * Add a token manually
   */
  const addToken = useCallback(
    (name: string, value?: string) => {
      // Check if already exists
      if (tokens.some((t) => t.name === name)) return;

      const isKnown = isKnownToken(name);
      const defaultValue = getTokenValue(name, theme);
      const finalValue = value ?? defaultValue ?? "";

      setTokens((prev) => [
        ...prev,
        {
          name,
          value: finalValue,
          autoDetected: false,
          isKnown,
          customized: !!value,
        },
      ]);

      if (value) {
        setCustomValues((prev) => ({ ...prev, [name]: value }));
      }
    },
    [tokens, theme]
  );

  /**
   * Remove a token
   */
  const removeToken = useCallback((name: string) => {
    setTokens((prev) => prev.filter((t) => t.name !== name));
    setCustomValues((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  /**
   * Update a token's value
   */
  const updateToken = useCallback((name: string, value: string) => {
    setTokens((prev) =>
      prev.map((t) => (t.name === name ? { ...t, value, customized: true } : t))
    );
    setCustomValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  /**
   * Reset a token to default value
   */
  const resetToken = useCallback(
    (name: string) => {
      const defaultValue = getTokenValue(name, theme) ?? "";
      setTokens((prev) =>
        prev.map((t) =>
          t.name === name ? { ...t, value: defaultValue, customized: false } : t
        )
      );
      setCustomValues((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    },
    [theme]
  );

  /**
   * Generate CSS for all tokens
   */
  const generateCSS = useCallback(() => {
    const declarations: string[] = [];

    for (const token of tokens) {
      if (token.value) {
        declarations.push(`--${token.name}: ${token.value};`);
      }
    }

    return `:root {\n  ${declarations.join("\n  ")}\n}`;
  }, [tokens]);

  /**
   * Refresh - re-extract tokens
   */
  const refresh = useCallback(async () => {
    await extractTokens();
  }, [extractTokens]);

  // Extract tokens on mount and when file path changes
  useEffect(() => {
    if (filePath) {
      extractTokens();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, additionalPaths.join(",")]);

  // Update token values when theme changes
  useEffect(() => {
    setTokens((prev) =>
      prev.map((t) => {
        if (t.customized) return t;
        const defaultValue = getTokenValue(t.name, theme) ?? t.value;
        return { ...t, value: defaultValue };
      })
    );
  }, [theme]);

  return {
    tokens,
    loading,
    error,
    theme,
    setTheme,
    addToken,
    removeToken,
    updateToken,
    resetToken,
    generateCSS,
    refresh,
  };
}

export default useDesignTokens;
