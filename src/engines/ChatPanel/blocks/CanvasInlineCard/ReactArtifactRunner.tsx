import React, { useEffect, useMemo } from "react";

export interface ReactArtifactError {
  message: string;
  stack?: string;
}

export interface ReactArtifactRunnerProps {
  source: string;
  onError?: (error: ReactArtifactError) => void;
}

interface ReactArtifactRuntimeState {
  Component: React.ComponentType | null;
  error: ReactArtifactError | null;
}

interface ReactArtifactErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: ReactArtifactError) => void;
}

interface ReactArtifactErrorBoundaryState {
  error: ReactArtifactError | null;
}

export function buildReactArtifactFactorySource(source: string): string {
  let code = source.replace(
    /^\s*import\s+React(?:\s*,\s*\{[^}]*\})?\s+from\s+["']react["'];?\s*$/gm,
    ""
  );
  code = code.replace(
    /^\s*import\s+\{[^}]*\}\s+from\s+["']react["'];?\s*$/gm,
    ""
  );

  if (/\bexport\s+default\s+function\s+App\s*\(/.test(code)) {
    code = code.replace(
      /\bexport\s+default\s+function\s+App\s*\(/,
      "function App("
    );
    return `${code}\n;return App;`;
  }

  if (/\bexport\s+default\s+function\s*\(/.test(code)) {
    code = code.replace(/\bexport\s+default\s+function\s*\(/, "function App(");
    return `${code}\n;return App;`;
  }

  const namedDefaultMatch = code.match(
    /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/
  );
  if (namedDefaultMatch) {
    code = code.replace(namedDefaultMatch[0], "");
    return `${code}\n;return ${namedDefaultMatch[1]};`;
  }

  if (/\bexport\s+default\s+/.test(code)) {
    code = code.replace(/\bexport\s+default\s+/, "const App = ");
    return `${code}\n;return App;`;
  }

  return `${code}\n;return typeof App !== "undefined" ? App : undefined;`;
}

function normalizeError(
  error: unknown,
  fallback = "React artifact error"
): ReactArtifactError {
  if (error instanceof Error) {
    return {
      message: error.message || fallback,
      stack: error.stack,
    };
  }
  return { message: String(error || fallback) };
}

function createReactArtifactComponent(
  source: string
): ReactArtifactRuntimeState {
  try {
    const factory = new Function(
      "React",
      buildReactArtifactFactorySource(source)
    );
    const Component = factory(React) as unknown;

    if (typeof Component !== "function") {
      throw new Error(
        "React artifact must export default App or declare function App()."
      );
    }

    return { Component: Component as React.ComponentType, error: null };
  } catch (error) {
    return { Component: null, error: normalizeError(error) };
  }
}

class ReactArtifactErrorBoundary extends React.Component<
  ReactArtifactErrorBoundaryProps,
  ReactArtifactErrorBoundaryState
> {
  state: ReactArtifactErrorBoundaryState = { error: null };

  static getDerivedStateFromError(
    error: unknown
  ): ReactArtifactErrorBoundaryState {
    return { error: normalizeError(error) };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(normalizeError(error));
  }

  render() {
    if (this.state.error) {
      return null;
    }
    return this.props.children;
  }
}

const ReactArtifactRunner: React.FC<ReactArtifactRunnerProps> = ({
  source,
  onError,
}) => {
  const runtime = useMemo(() => createReactArtifactComponent(source), [source]);

  useEffect(() => {
    if (runtime.error) {
      onError?.(runtime.error);
    }
  }, [onError, runtime.error]);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      onError?.(normalizeError(event.error ?? event.message));
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      onError?.(normalizeError(event.reason));
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [onError]);

  if (!runtime.Component) return null;

  const Component = runtime.Component;
  return (
    <div className="h-full w-full overflow-auto bg-bg-1 p-4 text-text-1">
      <ReactArtifactErrorBoundary onError={onError}>
        <Component />
      </ReactArtifactErrorBoundary>
    </div>
  );
};

export default ReactArtifactRunner;
