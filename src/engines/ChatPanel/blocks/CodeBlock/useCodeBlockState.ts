/**
 * useCodeBlockState — encapsulates all derived-value computations for
 * ChatCodeBlock so the component itself remains render-focused.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCallbackRefEffect } from "@src/hooks/dom/useCallbackRefEffect";
import { formatRepoPathForDisplay } from "@src/util/file/repoPathDisplay";

import { detectLanguageFromPath, getLanguageDisplayName } from "./config";
import {
  DEFAULT_VISIBLE_LINES,
  VIRTUAL_LINE_HEIGHT,
  VIRTUAL_SCROLL_THRESHOLD,
  parseUnifiedDiff,
  truncateDiff,
} from "./diffParser";

/** Languages for which the inline Preview button is shown. */
const PREVIEWABLE_LANGUAGES = new Set(["html", "svg", "css"]);

export interface UseCodeBlockStateOptions {
  code: string;
  language?: string;
  filePath?: string;
  title?: string;
  actionTitle?: string;
  separateTitle?: boolean;
  isLoading?: boolean;
  visibleLines?: number;
  linesAdded?: number;
  linesRemoved?: number;
  showLineCount?: boolean;
  isCollapsed: boolean;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function useCodeBlockState({
  code,
  language,
  filePath,
  title,
  actionTitle,
  separateTitle = false,
  isLoading = false,
  visibleLines = DEFAULT_VISIBLE_LINES,
  linesAdded,
  linesRemoved,
  showLineCount = true,
  isCollapsed,
}: UseCodeBlockStateOptions) {
  const useTerminalLayout = Boolean(actionTitle && separateTitle);

  const [isExpanded, setIsExpanded] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const handleTogglePreview = useCallback(() => {
    setIsPreviewOpen((prev) => !prev);
  }, []);

  const detectedLanguage = useMemo(() => {
    if (language) return language;
    if (filePath) return detectLanguageFromPath(filePath);
    return "text";
  }, [language, filePath]);

  const isPreviewable = useMemo(
    () =>
      !isLoading && PREVIEWABLE_LANGUAGES.has(detectedLanguage.toLowerCase()),
    [isLoading, detectedLanguage]
  );

  const languageDisplayName = useMemo(
    () => getLanguageDisplayName(detectedLanguage),
    [detectedLanguage]
  );

  const iconFileName = useMemo(() => {
    if (filePath) return filePath;
    if (title) return title;
    return `file.${detectedLanguage === "text" ? "txt" : detectedLanguage}`;
  }, [filePath, title, detectedLanguage]);

  const displayTitle = useMemo(() => {
    if (title) return title;
    if (filePath) {
      return (
        formatRepoPathForDisplay({ path: filePath }).displayPath ||
        languageDisplayName
      );
    }
    return languageDisplayName;
  }, [title, filePath, languageDisplayName]);

  const isDiff = detectedLanguage === "diff" || detectedLanguage === "patch";

  const parsedDiff = useMemo(() => {
    if (!isDiff) return null;
    return parseUnifiedDiff(code);
  }, [code, isDiff]);

  const hasProvidedStats =
    linesAdded !== undefined || linesRemoved !== undefined;

  const { addedLines, removedLines } = useMemo(() => {
    const bothZero = !linesAdded && !linesRemoved;
    if (hasProvidedStats && !(isDiff && bothZero)) {
      return {
        addedLines: linesAdded || 0,
        removedLines: linesRemoved || 0,
      };
    }
    if (!isDiff) {
      return { addedLines: 0, removedLines: 0 };
    }
    const lines = code?.split("\n") || [];
    let added = 0;
    let removed = 0;
    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) added++;
      else if (line.startsWith("-") && !line.startsWith("---")) removed++;
    }
    return { addedLines: added, removedLines: removed };
  }, [code, hasProvidedStats, isDiff, linesAdded, linesRemoved]);

  const shouldShowLineCount =
    showLineCount &&
    !isLoading &&
    isDiff &&
    (addedLines > 0 || removedLines > 0);

  const codeLines = useMemo(() => code?.split("\n") || [], [code]);

  const totalLineCount = useMemo(() => {
    if (isDiff && parsedDiff) {
      return parsedDiff.newValue.split("\n").length;
    }
    return codeLines.length;
  }, [isDiff, parsedDiff, codeLines]);

  const needsExpand = !isLoading && totalLineCount > visibleLines;

  const displayedCode = useMemo(() => {
    if (isLoading || isExpanded || !needsExpand) return code;
    return codeLines.slice(0, visibleLines).join("\n");
  }, [code, codeLines, isLoading, isExpanded, needsExpand, visibleLines]);

  const displayedDiff = useMemo(() => {
    if (!isDiff) return null;
    if (isLoading || isExpanded || !needsExpand) return parsedDiff;
    return parseUnifiedDiff(truncateDiff(code, visibleLines));
  }, [
    isDiff,
    parsedDiff,
    code,
    isLoading,
    isExpanded,
    needsExpand,
    visibleLines,
  ]);

  const displayedLineCount =
    isLoading || isExpanded
      ? totalLineCount
      : Math.min(totalLineCount, visibleLines);

  const contentHeight = useMemo(() => {
    if (isCollapsed) return 0;
    return displayedLineCount * 18 + 16;
  }, [isCollapsed, displayedLineCount]);

  const useVirtualScroll =
    isExpanded && totalLineCount > VIRTUAL_SCROLL_THRESHOLD;

  const virtualListHeight = useVirtualScroll
    ? Math.min(400, totalLineCount * VIRTUAL_LINE_HEIGHT)
    : contentHeight;

  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const containerRefCb = useCallbackRefEffect<HTMLDivElement>((el) => {
    const onScroll = () => {
      setIsScrolling(true);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 1200);
    };
    el.addEventListener("scroll", onScroll, { capture: true });
    return () => {
      el.removeEventListener("scroll", onScroll, { capture: true });
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, []);

  const streamingWrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isLoading) return;
    const wrapper = streamingWrapperRef.current;
    if (wrapper) {
      wrapper.scrollTo({ top: wrapper.scrollHeight, behavior: "smooth" });
    }
  }, [code, isLoading]);

  return {
    useTerminalLayout,
    isExpanded,
    setIsExpanded,
    isPreviewOpen,
    handleTogglePreview,
    detectedLanguage,
    isPreviewable,
    iconFileName,
    displayTitle,
    isDiff,
    parsedDiff,
    addedLines,
    removedLines,
    shouldShowLineCount,
    needsExpand,
    displayedCode,
    displayedDiff,
    contentHeight,
    useVirtualScroll,
    virtualListHeight,
    isScrolling,
    containerRefCb,
    streamingWrapperRef,
  };
}
