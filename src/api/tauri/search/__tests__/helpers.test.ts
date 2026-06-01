import { vi } from "vitest";

import {
  formatRelativePath,
  getTotalMatchCount,
  getTotalSymbolCount,
  groupSymbolsByKind,
} from "../helpers";

vi.mock("@src/util/file/pathUtils", () => ({
  getFileExtension: (path: string) => path.split(".").pop() || "",
  getFileName: (path: string) => path.split("/").pop() || "",
}));

interface SearchMatch {
  line: number;
  column: number;
  end_line: number;
  end_column: number;
  text: string;
  context_before: string;
  context_after: string;
}

interface CodeSearchResult {
  file_path: string;
  matches: SearchMatch[];
}

interface SymbolInfo {
  name: string;
  kind: string;
  line: number;
  column: number;
  end_line: number;
  end_column: number;
}

interface SymbolSearchResult {
  file_path: string;
  symbols: SymbolInfo[];
}

function match(overrides: Partial<SearchMatch> = {}): SearchMatch {
  return {
    line: 1,
    column: 0,
    end_line: 1,
    end_column: 1,
    text: "x",
    context_before: "",
    context_after: "",
    ...overrides,
  };
}

function symbol(overrides: Partial<SymbolInfo> = {}): SymbolInfo {
  return {
    name: "sym",
    kind: "function",
    line: 1,
    column: 0,
    end_line: 1,
    end_column: 1,
    ...overrides,
  };
}

describe("getTotalMatchCount", () => {
  it("sums matches across results", () => {
    const results: CodeSearchResult[] = [
      { file_path: "a.ts", matches: [match(), match()] },
      { file_path: "b.ts", matches: [match()] },
      { file_path: "c.ts", matches: [] },
    ];
    expect(getTotalMatchCount(results)).toBe(3);
  });
});

describe("getTotalSymbolCount", () => {
  it("sums symbols across results", () => {
    const results: SymbolSearchResult[] = [
      { file_path: "a.ts", symbols: [symbol(), symbol()] },
      { file_path: "b.ts", symbols: [symbol()] },
      { file_path: "c.ts", symbols: [] },
    ];
    expect(getTotalSymbolCount(results)).toBe(3);
  });
});

describe("groupSymbolsByKind", () => {
  it("groups symbols by kind property", () => {
    const symbols: SymbolInfo[] = [
      symbol({ name: "a", kind: "function" }),
      symbol({ name: "b", kind: "class" }),
      symbol({ name: "c", kind: "function" }),
    ];
    const grouped = groupSymbolsByKind(symbols);
    expect(Object.keys(grouped).sort()).toEqual(["class", "function"]);
    expect(grouped.function?.map((s) => s.name)).toEqual(["a", "c"]);
    expect(grouped.class?.map((s) => s.name)).toEqual(["b"]);
  });
});

describe("formatRelativePath", () => {
  it("strips repo prefix and normalizes leading slash", () => {
    expect(formatRelativePath("/repo/src/foo.ts", "/repo")).toBe("src/foo.ts");
  });

  it("handles repo path with trailing slash", () => {
    expect(formatRelativePath("/repo/src/foo.ts", "/repo/")).toBe("src/foo.ts");
  });

  it("returns file path unchanged when it does not start with repo path", () => {
    expect(formatRelativePath("other/foo.ts", "/repo")).toBe("other/foo.ts");
  });
});
