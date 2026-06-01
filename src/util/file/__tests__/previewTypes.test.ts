import { vi } from "vitest";

import {
  getImageMimeType,
  getPreviewType,
  isPreviewOnlyFile,
  isPreviewableFile,
  supportsPreviewToggle,
} from "../previewTypes";

vi.mock("@src/util/platform/tauri", () => ({
  isMacOS: vi.fn(() => true),
}));

vi.mock("../binaryDetection", () => ({
  isBinaryByExtension: vi.fn(() => false),
}));

describe("getPreviewType", () => {
  it("classifies common extensions", () => {
    expect(getPreviewType("photo.png")).toBe("image");
    expect(getPreviewType("data.json")).toBe("json");
    expect(getPreviewType("styles.css")).toBe("code");
    expect(getPreviewType("doc.pdf")).toBe("pdf");
    expect(getPreviewType("report.docx")).toBe("docx");
    expect(getPreviewType("sheet.xlsx")).toBe("xlsx");
    expect(getPreviewType("slides.pptx")).toBe("pptx");
    expect(getPreviewType("data.csv")).toBe("csv");
    expect(getPreviewType("data.tsv")).toBe("csv");
    expect(getPreviewType("readme.md")).toBe("markdown");
    expect(getPreviewType("rule.mdc")).toBe("markdown");
    expect(getPreviewType("page.html")).toBe("html");
    expect(getPreviewType("app.db")).toBe("database");
    expect(getPreviewType("data.sqlite")).toBe("database");
    expect(getPreviewType("clip.mp4")).toBe("video");
    expect(getPreviewType("clip.webm")).toBe("video");
  });

  it("returns code for empty path", () => {
    expect(getPreviewType("")).toBe("code");
  });

  it("returns pages on macOS for .pages", () => {
    expect(getPreviewType("doc.pages")).toBe("pages");
  });

  it("classifies office document extensions individually", () => {
    expect(getPreviewType("a.pdf")).toBe("pdf");
    expect(getPreviewType("a.docx")).toBe("docx");
    expect(getPreviewType("a.doc")).toBe("docx");
    expect(getPreviewType("a.xlsx")).toBe("xlsx");
    expect(getPreviewType("a.xls")).toBe("xlsx");
    expect(getPreviewType("a.pptx")).toBe("pptx");
    expect(getPreviewType("a.ppt")).toBe("pptx");
    expect(getPreviewType("a.pages")).toBe("pages");
    expect(getPreviewType("a.sqlite")).toBe("database");
  });
});

describe("isPreviewableFile", () => {
  it("returns true for preview types other than code/binary", () => {
    expect(isPreviewableFile("data.json")).toBe(true);
  });

  it("returns false for code files", () => {
    expect(isPreviewableFile("script.js")).toBe(false);
  });
});

describe("supportsPreviewToggle", () => {
  it("returns true for json, csv, markdown, html", () => {
    expect(supportsPreviewToggle("data.json")).toBe(true);
  });

  it("returns false for image", () => {
    expect(supportsPreviewToggle("photo.png")).toBe(false);
  });
});

describe("isPreviewOnlyFile", () => {
  it("returns true for preview-only types", () => {
    expect(isPreviewOnlyFile("x.png")).toBe(true);
    expect(isPreviewOnlyFile("x.pdf")).toBe(true);
    expect(isPreviewOnlyFile("x.docx")).toBe(true);
    expect(isPreviewOnlyFile("x.xlsx")).toBe(true);
    expect(isPreviewOnlyFile("x.pptx")).toBe(true);
    expect(isPreviewOnlyFile("x.pages")).toBe(true);
    expect(isPreviewOnlyFile("x.db")).toBe(true);
    expect(isPreviewOnlyFile("x.mp4")).toBe(true);
  });
});

describe("getImageMimeType", () => {
  it("returns MIME for known image extensions", () => {
    expect(getImageMimeType("photo.png")).toBe("image/png");
    expect(getImageMimeType("photo.jpg")).toBe("image/jpeg");
  });

  it("returns undefined for non-images", () => {
    expect(getImageMimeType("script.js")).toBeUndefined();
  });
});
