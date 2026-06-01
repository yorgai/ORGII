import {
  decodeOctalPath,
  getBaseName,
  getDirectory,
  getFileExtension,
  getFileExtensionLower,
  getFileName,
} from "../pathUtils";

describe("decodeOctalPath", () => {
  it("passes through plain ASCII", () => {
    expect(decodeOctalPath("plain-ascii.ts")).toBe("plain-ascii.ts");
  });

  it("decodes quoted path with octal bytes", () => {
    expect(decodeOctalPath('"He_CV\\344\\270\\255.pdf"')).toBe("He_CV中.pdf");
  });

  it("is no-op when no backslash", () => {
    expect(decodeOctalPath("no-backslash-here.txt")).toBe(
      "no-backslash-here.txt"
    );
  });
});

describe("getFileExtension", () => {
  it("returns extension without dot for normal paths", () => {
    expect(getFileExtension("src/components/Button.tsx")).toBe("tsx");
    expect(getFileExtension("README.md")).toBe("md");
  });

  it("returns empty when no extension", () => {
    expect(getFileExtension("README")).toBe("");
  });

  it("treats dotfiles as having extension after first dot", () => {
    expect(getFileExtension(".gitignore")).toBe("gitignore");
  });

  it("returns empty for empty string", () => {
    expect(getFileExtension("")).toBe("");
  });
});

describe("getFileName", () => {
  it("returns last segment with directory", () => {
    expect(getFileName("src/components/Button.tsx")).toBe("Button.tsx");
  });

  it("returns whole path when no separator", () => {
    expect(getFileName("README.md")).toBe("README.md");
  });

  it("returns empty for empty input", () => {
    expect(getFileName("")).toBe("");
  });

  it("handles Windows backslash separators", () => {
    expect(getFileName("src\\components\\Button.tsx")).toBe("Button.tsx");
    expect(getFileName("C:\\Users\\dev\\project\\main.rs")).toBe("main.rs");
  });

  it("handles mixed separators", () => {
    expect(getFileName("src/components\\Button.tsx")).toBe("Button.tsx");
  });
});

describe("getBaseName", () => {
  it("strips extension when present", () => {
    expect(getBaseName("src/components/Button.tsx")).toBe("Button");
  });

  it("returns full name when no extension", () => {
    expect(getBaseName("file")).toBe("file");
  });

  it("returns empty for empty input", () => {
    expect(getBaseName("")).toBe("");
  });
});

describe("getDirectory", () => {
  it("returns directory for nested path", () => {
    expect(getDirectory("src/components/Button.tsx")).toBe("src/components");
  });

  it("returns empty for flat filename", () => {
    expect(getDirectory("README.md")).toBe("");
  });

  it("returns empty for empty input", () => {
    expect(getDirectory("")).toBe("");
  });

  it("handles Windows backslash separators", () => {
    expect(getDirectory("src\\components\\Button.tsx")).toBe("src/components");
    expect(getDirectory("C:\\Users\\dev\\project\\main.rs")).toBe(
      "C:/Users/dev/project"
    );
  });

  it("handles mixed separators", () => {
    expect(getDirectory("src/components\\Button.tsx")).toBe("src/components");
  });
});

describe("getFileExtensionLower", () => {
  it("lowercases extension", () => {
    expect(getFileExtensionLower("Image.PNG")).toBe("png");
    expect(getFileExtensionLower("a.TxT")).toBe("txt");
  });
});
