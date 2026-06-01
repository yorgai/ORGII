import {
  getBinaryFileMessage,
  isBinaryByExtension,
  isBinaryContent,
  isTextFile,
} from "../binaryDetection";

describe("isBinaryByExtension", () => {
  it("returns false for empty path", () => {
    expect(isBinaryByExtension("")).toBe(false);
  });

  it("detects known binary extensions", () => {
    expect(isBinaryByExtension("photo.PNG")).toBe(true);
    expect(isBinaryByExtension("archive.zip")).toBe(true);
    expect(isBinaryByExtension("app.wasm")).toBe(true);
  });

  it("returns false for typical text source files", () => {
    expect(isBinaryByExtension("src/index.ts")).toBe(false);
    expect(isBinaryByExtension("package.json")).toBe(false);
  });

  it("treats extensionless paths matching binary heuristics as binary", () => {
    expect(isBinaryByExtension("release/myapp-x86_64")).toBe(true);
    expect(isBinaryByExtension("foo-helper")).toBe(true);
  });

  it("allows known text filenames without extensions", () => {
    expect(isBinaryByExtension("Makefile")).toBe(false);
    expect(isBinaryByExtension("path/to/Dockerfile")).toBe(false);
  });
});

describe("isBinaryContent", () => {
  it("returns false for empty content", () => {
    expect(isBinaryContent("")).toBe(false);
  });

  it("detects null bytes", () => {
    expect(isBinaryContent("hello\x00world")).toBe(true);
  });

  it("flags high ratio of non-printable characters", () => {
    const noisy = "\x01".repeat(40);
    expect(isBinaryContent(noisy, 100)).toBe(true);
  });

  it("allows normal printable text", () => {
    const text = "Hello world\n".repeat(100);
    expect(isBinaryContent(text, 8000)).toBe(false);
  });
});

describe("isTextFile", () => {
  it("returns false when extension is binary", () => {
    expect(isTextFile("image.png")).toBe(false);
  });

  it("returns false when content is binary", () => {
    expect(isTextFile("unknown.txt", "\x00\x01")).toBe(false);
  });

  it("returns true for text path without content check", () => {
    expect(isTextFile("readme.md")).toBe(true);
  });

  it("returns true for text path with safe content", () => {
    expect(isTextFile("file.txt", "plain text")).toBe(true);
  });
});

describe("getBinaryFileMessage", () => {
  it("returns a non-empty user-facing message", () => {
    expect(getBinaryFileMessage().length).toBeGreaterThan(10);
  });
});
