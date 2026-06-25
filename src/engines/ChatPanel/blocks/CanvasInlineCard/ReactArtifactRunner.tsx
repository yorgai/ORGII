import DOMPurify from "dompurify";
import React, { useCallback, useMemo, useState } from "react";
import { LiveError, LivePreview, LiveProvider } from "react-live";

export interface ReactArtifactError {
  message: string;
  stack?: string;
}

export interface ReactArtifactRunnerProps {
  source: string;
  sourceKind?: "react" | "html";
  onError?: (error: ReactArtifactError) => void;
}

export function normalizeReactLiveSource(source: string): string {
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
    return `${code}\nrender(<App />);`;
  }

  if (/\bexport\s+default\s+function\s*\(/.test(code)) {
    code = code.replace(/\bexport\s+default\s+function\s*\(/, "function App(");
    return `${code}\nrender(<App />);`;
  }

  const namedDefaultMatch = code.match(
    /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/
  );
  if (namedDefaultMatch) {
    code = code.replace(namedDefaultMatch[0], "");
    return `${code}\nrender(<${namedDefaultMatch[1]} />);`;
  }

  if (/\bexport\s+default\s+/.test(code)) {
    code = code.replace(/\bexport\s+default\s+/, "const App = ");
    return `${code}\nrender(<App />);`;
  }

  if (/\bfunction\s+App\s*\(|\bconst\s+App\s*=|\blet\s+App\s*=/.test(code)) {
    return `${code}\nrender(<App />);`;
  }

  return code;
}

function sanitizeHtmlForLiveSource(source: string): string {
  const purifier = DOMPurify as unknown as {
    sanitize?: (html: string) => string;
  };

  if (typeof purifier.sanitize === "function") {
    return purifier.sanitize(source);
  }

  if (typeof window !== "undefined" && typeof DOMPurify === "function") {
    const createPurifier = DOMPurify as unknown as (window: Window) => {
      sanitize?: (html: string) => string;
    };
    const browserPurifier = createPurifier(window);
    if (typeof browserPurifier.sanitize === "function") {
      return browserPurifier.sanitize(source);
    }
  }

  return source.replace(
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    ""
  );
}

export function normalizeHtmlLiveSource(source: string): string {
  const safeHtml = JSON.stringify(sanitizeHtmlForLiveSource(source));
  return `render(<div className="h-full w-full" dangerouslySetInnerHTML={{ __html: ${safeHtml} }} />);`;
}

const ReactArtifactRunner: React.FC<ReactArtifactRunnerProps> = ({
  source,
  sourceKind = "react",
  onError,
}) => {
  const [lastError, setLastError] = useState<string | null>(null);
  const liveSource = useMemo(
    () =>
      sourceKind === "html"
        ? normalizeHtmlLiveSource(source)
        : normalizeReactLiveSource(source),
    [source, sourceKind]
  );

  const handleError = useCallback(
    (message: string) => {
      const normalizedMessage = message || "React artifact error";
      setLastError(normalizedMessage);
      onError?.({ message: normalizedMessage });
    },
    [onError]
  );

  return (
    <LiveProvider code={liveSource} noInline scope={{ React }}>
      <div className="h-full w-full overflow-auto bg-bg-1 p-4 text-text-1">
        <LivePreview />
        <LiveError
          className="hidden"
          onChange={(message: string) => {
            if (message && message !== lastError) {
              handleError(message);
            }
          }}
        />
      </div>
    </LiveProvider>
  );
};

export default ReactArtifactRunner;
