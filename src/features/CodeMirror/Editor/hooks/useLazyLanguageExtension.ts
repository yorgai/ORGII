/**
 * useLazyLanguageExtension Hook
 *
 * Handles lazy loading of CodeMirror language extensions.
 * JS/TS are loaded synchronously (always bundled), other languages are lazy-loaded.
 */
import { Extension } from "@codemirror/state";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getLanguageExtensionSync,
  getLanguageKey,
  loadLanguageExtension,
} from "../../shared/languageExtensions";

export interface UseLazyLanguageExtensionOptions {
  /** File path for language detection */
  filePath?: string;
  /** Explicit language override */
  language?: string;
}

interface LoadedExtensionData {
  langKey: string;
  extension: Extension;
}

/**
 * Hook to lazy-load language extensions for CodeMirror
 *
 * @returns The loaded language extension, or null if loading/not available
 */
export function useLazyLanguageExtension(
  options: UseLazyLanguageExtensionOptions
): Extension | null {
  const { filePath, language } = options;

  // Compute language key and sync extension during render (not in effect)
  const langKey = useMemo(
    () => getLanguageKey(filePath, language),
    [filePath, language]
  );
  const syncExtension = useMemo(
    () => (langKey ? getLanguageExtensionSync(langKey) : null),
    [langKey]
  );

  // State stores both the extension and which langKey it was loaded for
  // This avoids needing to call setState synchronously in the effect
  const [loadedData, setLoadedData] = useState<LoadedExtensionData | null>(
    null
  );
  const loadingLangKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip if no language key or sync extension exists
    if (!langKey || syncExtension) return;

    // Skip if already loading this language
    if (loadingLangKeyRef.current === langKey) return;
    loadingLangKeyRef.current = langKey;

    // Lazy load the language extension
    const currentLangKey = langKey;
    loadLanguageExtension(currentLangKey).then((ext) => {
      // Only update if still the same language being loaded
      if (loadingLangKeyRef.current === currentLangKey && ext) {
        setLoadedData({ langKey: currentLangKey, extension: ext });
      }
    });
  }, [langKey, syncExtension]);

  // Only use async extension if it matches the current language key
  const validAsyncExtension =
    loadedData?.langKey === langKey ? loadedData.extension : null;

  // Return sync extension if available, otherwise async
  return syncExtension ?? validAsyncExtension;
}
