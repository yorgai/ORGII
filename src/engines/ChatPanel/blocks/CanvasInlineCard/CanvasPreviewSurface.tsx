import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { A2UIActionHandler } from "./A2UIActionContext";
import A2UIRenderer, { type A2UIRendererHandle } from "./A2UIRenderer";
import ReactArtifactRunner, {
  type ReactArtifactError,
} from "./ReactArtifactRunner";
import { buildHtmlDocument } from "./canvasBuilder";
import {
  CANVAS_HTML_IFRAME_SANDBOX,
  type CanvasPreviewPayload,
  type CanvasPreviewSurfaceVariant,
  getCanvasPreviewRenderKind,
  getCanvasUrlIframeSandbox,
  splitA2UIContent,
} from "./canvasPreviewPolicy";

export interface CanvasPreviewSurfaceHandle {
  evalScript: (javascript: string) => void;
}

export interface CanvasPreviewSurfaceProps {
  payload: CanvasPreviewPayload | null | undefined;
  variant?: CanvasPreviewSurfaceVariant;
  title?: string;
  className?: string;
  iframeClassName?: string;
  a2uiClassName?: string;
  emptyFallback?: React.ReactNode;
  loadingFallback?: React.ReactNode;
  reloadKey?: number;
  sessionId?: string;
  onAction?: A2UIActionHandler;
}

const CanvasPreviewSurface = forwardRef<
  CanvasPreviewSurfaceHandle,
  CanvasPreviewSurfaceProps
>(
  (
    {
      payload,
      variant = "inline",
      title = "Canvas Preview",
      className = "relative h-full w-full",
      iframeClassName = "h-full w-full border-0",
      a2uiClassName = "h-full",
      emptyFallback = null,
      loadingFallback = emptyFallback,
      reloadKey,
      sessionId,
      onAction,
    },
    ref
  ) => {
    const rendererRef = useRef<A2UIRendererHandle>(null);
    const renderKind = getCanvasPreviewRenderKind(payload);
    const payloadContent = payload?.content;
    const errorKey =
      renderKind === "react"
        ? `${payloadContent ?? ""}:${reloadKey ?? ""}`
        : "";
    const [reactArtifactError, setReactArtifactError] = useState<{
      key: string;
      message: string;
      stack?: string;
    } | null>(null);

    const handleReactArtifactError = useCallback(
      (error: ReactArtifactError) => {
        setReactArtifactError({
          key: errorKey,
          message: error.message,
          stack: error.stack,
        });
      },
      [errorKey]
    );

    useImperativeHandle(
      ref,
      () => ({
        evalScript: (javascript: string) => {
          rendererRef.current?.evalScript(javascript);
        },
      }),
      []
    );

    const a2uiLines = useMemo(() => {
      if (renderKind !== "a2ui" || !payloadContent) return [];
      return splitA2UIContent(payloadContent);
    }, [renderKind, payloadContent]);

    const htmlSrcDoc = useMemo(() => {
      if (renderKind !== "html" || !payloadContent) return undefined;
      return buildHtmlDocument(payloadContent);
    }, [renderKind, payloadContent]);

    let content: React.ReactNode;

    if (renderKind === "url" && payload?.url) {
      content = (
        <iframe
          key={reloadKey === undefined ? undefined : `url-${reloadKey}`}
          src={payload.url}
          className={iframeClassName}
          sandbox={getCanvasUrlIframeSandbox(variant)}
          title={title}
        />
      );
    } else if (renderKind === "a2ui") {
      content =
        a2uiLines.length === 0 ? (
          <>{payload?.streaming ? loadingFallback : emptyFallback}</>
        ) : (
          <A2UIRenderer
            ref={rendererRef}
            lines={a2uiLines}
            isStreaming={payload?.streaming}
            onAction={onAction}
            sessionId={sessionId}
            className={a2uiClassName}
          />
        );
    } else if (renderKind === "html" && htmlSrcDoc) {
      content = (
        <iframe
          key={reloadKey === undefined ? undefined : `doc-${reloadKey}`}
          srcDoc={htmlSrcDoc}
          className={iframeClassName}
          sandbox={CANVAS_HTML_IFRAME_SANDBOX}
          title={title}
        />
      );
    } else if (renderKind === "react" && payloadContent) {
      content = (
        <ReactArtifactRunner
          key={reloadKey === undefined ? undefined : `react-${reloadKey}`}
          source={payloadContent}
          onError={handleReactArtifactError}
        />
      );
    } else {
      content = emptyFallback;
    }

    return (
      <div className={className}>
        {content}
        {reactArtifactError?.key === errorKey && (
          <div className="absolute inset-x-3 bottom-3 rounded-md border border-red-500/40 bg-red-500/15 p-2 text-xs text-red-100 shadow-lg backdrop-blur">
            <div className="font-medium">{reactArtifactError.message}</div>
            {reactArtifactError.stack && (
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-4 text-red-100/80">
                {reactArtifactError.stack}
              </pre>
            )}
          </div>
        )}
      </div>
    );
  }
);

CanvasPreviewSurface.displayName = "CanvasPreviewSurface";

export default CanvasPreviewSurface;
