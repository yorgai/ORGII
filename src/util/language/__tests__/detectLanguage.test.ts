import {
  detectLanguageFromExtension,
  detectLanguageFromPath,
  isCodeLanguage,
  isDiffFile,
} from "../detectLanguage";

describe("detectLanguageFromPath", () => {
  it("returns text for empty path", () => {
    expect(detectLanguageFromPath("")).toBe("text");
  });

  it("resolves special filenames before extension", () => {
    expect(detectLanguageFromPath("project/Makefile")).toBe("makefile");
    expect(detectLanguageFromPath("/abs/Dockerfile")).toBe("dockerfile");
    expect(detectLanguageFromPath("package.json")).toBe("json");
  });

  it("uses lowercase extension when no special filename applies", () => {
    expect(detectLanguageFromPath("src/App.tsx")).toBe("tsx");
    expect(detectLanguageFromPath("script.PY")).toBe("py");
  });

  it("returns extension segment for unknown extensions", () => {
    expect(detectLanguageFromPath("file.xyz")).toBe("xyz");
  });
});

describe("detectLanguageFromExtension", () => {
  it("returns text for empty input", () => {
    expect(detectLanguageFromExtension("")).toBe("text");
  });

  it("strips a leading dot and lowercases", () => {
    expect(detectLanguageFromExtension(".TS")).toBe("ts");
    expect(detectLanguageFromExtension("RS")).toBe("rs");
  });
});

describe("isDiffFile", () => {
  it("detects diff and patch extensions", () => {
    expect(isDiffFile("a.diff")).toBe(true);
    expect(isDiffFile("b.patch")).toBe(true);
    expect(isDiffFile("c.ts")).toBe(false);
  });
});

describe("isCodeLanguage", () => {
  it("treats common prose types as non-code", () => {
    expect(isCodeLanguage("text")).toBe(false);
    expect(isCodeLanguage("Markdown")).toBe(false);
    expect(isCodeLanguage("md")).toBe(false);
    expect(isCodeLanguage("plain")).toBe(false);
  });

  it("treats programming language ids as code", () => {
    expect(isCodeLanguage("ts")).toBe(true);
    expect(isCodeLanguage("Rust")).toBe(true);
  });
});
