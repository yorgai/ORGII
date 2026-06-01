import React, { memo } from "react";

import { BenchmarkPanel } from "@src/features/BenchmarkPanel";

import type { UnifiedTabContentProps } from "../types";

const BenchmarkTabRenderer: React.FC<UnifiedTabContentProps> = memo(() => (
  <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
    <BenchmarkPanel />
  </div>
));

BenchmarkTabRenderer.displayName = "BenchmarkTabRenderer";

export default BenchmarkTabRenderer;
