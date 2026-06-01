import { useEffect, useMemo, useState } from "react";

/** Progressively reveals lines of `fullContent` to simulate real SSE streaming. */
export function useStreamingSimulation(
  fullContent: string | undefined,
  isActive: boolean,
  intervalMs = 45,
  linesPerTick = 2
): string | undefined {
  const [tick, setTick] = useState(0);
  const allLines = useMemo(() => fullContent?.split("\n") ?? [], [fullContent]);

  useEffect(() => {
    if (!isActive || !fullContent) {
      const resetId = setTimeout(() => setTick(0), 0);
      return () => clearTimeout(resetId);
    }
    let counter = 0;
    const totalLines = fullContent.split("\n").length;
    const id = setInterval(() => {
      counter += 1;
      const visible = (counter + 1) * linesPerTick;
      if (visible >= totalLines) {
        counter = 0;
      }
      setTick(counter);
    }, intervalMs);
    const resetId = setTimeout(() => setTick(0), 0);
    return () => {
      clearInterval(id);
      clearTimeout(resetId);
    };
  }, [isActive, fullContent, intervalMs, linesPerTick]);

  if (!isActive || !fullContent) return undefined;
  const visibleLineCount = Math.min((tick + 1) * linesPerTick, allLines.length);
  return allLines.slice(0, visibleLineCount).join("\n");
}
