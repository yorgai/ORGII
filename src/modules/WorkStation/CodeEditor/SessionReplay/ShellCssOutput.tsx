/**
 * Simulator shell replay using DOM + CSS, styled from the same terminal
 * settings as Workstation (theme palette + font atoms). Avoids xterm canvas/WebGL glitches.
 * Command: Shiki shellscript; output: Shiki log (build-style lines), theme follows app light/dark.
 */
import type { CSSProperties } from "react";
import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { TerminalCommand } from "@src/components/TerminalDisplay";
import { stripAnsiCodes } from "@src/components/TerminalDisplay/utils/ansiProcessor";
import { useShikiHighlight } from "@src/hooks/code";
import { useTerminalSurfaceStyle } from "@src/hooks/terminal/useTerminalSurfaceStyle";
import { useCurrentTheme } from "@src/util/ui/theme/themeUtils";

import "./ShellCssOutput.scss";

export interface SimulatorShellCssOutputProps {
  command: string;
  output: string;
  exitCode?: number;
  isLoading?: boolean;
  /** Live streaming output shown while command is running (replaces static output during loading) */
  streamOutput?: string;
  /** When true, omit the inline command row (caller renders command elsewhere) */
  hideCommandLine?: boolean;
}

const SimulatorShellCssOutputComponent: React.FC<
  SimulatorShellCssOutputProps
> = ({
  command,
  output,
  exitCode,
  isLoading,
  streamOutput,
  hideCommandLine = false,
}) => {
  const { t } = useTranslation("sessions");
  const {
    foreground,
    mutedForeground,
    errorForeground,
    terminalFontSize,
    typography,
  } = useTerminalSurfaceStyle();

  const { isDark } = useCurrentTheme();
  const shikiTheme = isDark ? "one-dark-pro" : "github-light";

  const isStreaming = isLoading && !!streamOutput;
  const displayOutput = isStreaming ? streamOutput : output;
  const plainOutput = stripAnsiCodes(displayOutput ?? "");
  const displayCommand =
    command.trim() || t("simulator.replay.ide.shell.noCommand");

  // Skip Shiki during streaming — it's async and slow; plain text is fine
  // while output is still arriving. Shiki kicks in once the command finishes.
  const highlightedOutputHtml = useShikiHighlight(plainOutput, {
    lang: "log",
    theme: shikiTheme,
    enabled: !isStreaming && plainOutput.length > 0,
  });

  const surfaceTypographyVars = useMemo((): CSSProperties => {
    const letterSpacing = typography.letterSpacing;
    const letterSpacingCss =
      typeof letterSpacing === "number"
        ? `${letterSpacing}px`
        : (letterSpacing ?? "normal");
    return {
      ["--simulator-shell-font-size" as string]: `${terminalFontSize}px`,
      ["--simulator-shell-font-family" as string]: String(
        typography.fontFamily ?? "monospace"
      ),
      ["--simulator-shell-letter-spacing" as string]: String(letterSpacingCss),
      ["--simulator-shell-line-height" as string]: String(
        typography.lineHeight ?? 1.45
      ),
    } as CSSProperties;
  }, [terminalFontSize, typography]);

  return (
    <div
      className="simulator-shell-surface min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2"
      style={surfaceTypographyVars}
    >
      {!hideCommandLine ? (
        <div className="mb-1 min-w-0 max-w-full">
          <TerminalCommand
            command={displayCommand}
            prefix="$"
            highlighted
            shikiTheme={shikiTheme}
            style={{
              padding: 0,
              margin: 0,
            }}
          />
        </div>
      ) : null}
      {plainOutput ? (
        highlightedOutputHtml ? (
          <div
            className="simulator-shell-shiki-output m-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] [&_pre.shiki]:!m-0 [&_pre.shiki]:!whitespace-pre-wrap [&_pre.shiki]:!bg-transparent [&_pre.shiki]:!p-0 [&_pre.shiki]:!shadow-none"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: highlightedOutputHtml }}
          />
        ) : (
          <pre
            className="simulator-shell-plain-pre m-0 min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            style={{ color: foreground }}
          >
            {plainOutput}
          </pre>
        )
      ) : null}
      {isLoading ? (
        <div
          className={`mt-1${plainOutput ? "animate-pulse" : ""}`}
          style={{ ...typography, color: mutedForeground }}
        >
          {t("simulator.replay.ide.shell.outputInProgress")}
        </div>
      ) : null}
      {!isLoading && exitCode !== undefined ? (
        <div
          className="mt-2"
          style={{
            ...typography,
            color: exitCode === 0 ? mutedForeground : errorForeground,
          }}
        >
          {t("simulator.replay.ide.shell.exitCode", { code: exitCode })}
        </div>
      ) : null}
    </div>
  );
};

export const SimulatorShellCssOutput = memo(SimulatorShellCssOutputComponent);
SimulatorShellCssOutput.displayName = "SimulatorShellCssOutput";
