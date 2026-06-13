/**
 * Markdown Component (Lazy Wrapper)
 *
 * Thin re-export that lazy-loads the actual implementation.
 * This keeps ~700KB of react-markdown + react-syntax-highlighter + remark-gfm
 * out of the initial bundle. All 20+ consumers import from this file, so
 * they all benefit automatically.
 *
 * The Suspense boundary is provided here so callers don't need to add one.
 */
import React, { Component, type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { createLogger } from "@src/hooks/logger";

import type { MarkdownProps } from "./MarkDownImpl";

const log = createLogger("Markdown");

interface MarkdownErrorBoundaryProps {
  children: ReactNode;
}

interface MarkdownErrorBoundaryState {
  error?: Error;
}

class MarkdownErrorBoundary extends Component<
  MarkdownErrorBoundaryProps,
  MarkdownErrorBoundaryState
> {
  constructor(props: MarkdownErrorBoundaryProps) {
    super(props);
    this.state = {};
  }

  static getDerivedStateFromError(error: Error): MarkdownErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    log.error("Markdown preview failed to render:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return <MarkdownPreviewError />;
    }

    return this.props.children;
  }
}

function MarkdownPreviewLoading() {
  const { t } = useTranslation();
  return <span className="text-text-3">{t("common:actions.loading")}</span>;
}

function MarkdownPreviewError() {
  const { t } = useTranslation();
  return (
    <span className="text-danger-6">{t("common:errors.unexpectedError")}</span>
  );
}

const MarkdownImpl = React.lazy(
  () => import(/* webpackChunkName: "markdown-renderer" */ "./MarkDownImpl")
);

/**
 * Lazy-loaded Markdown renderer.
 */
const Markdown: React.FC<MarkdownProps> = (props) => (
  <MarkdownErrorBoundary>
    <Suspense fallback={<MarkdownPreviewLoading />}>
      <MarkdownImpl {...props} />
    </Suspense>
  </MarkdownErrorBoundary>
);

Markdown.displayName = "Markdown";

export default Markdown;
