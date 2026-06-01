import { decodeUnicodeEscapes, decodeUnicodeEscapesDeep } from "../unicode";

describe("decodeUnicodeEscapes", () => {
  it("decodes a single Chinese code unit", () => {
    expect(decodeUnicodeEscapes("\\u4e3a")).toBe("为");
  });

  it("decodes multiple escapes in one string", () => {
    expect(decodeUnicodeEscapes("\\u4e3a\\u4e86")).toBe("为了");
  });

  it("leaves plain text around escapes unchanged aside from decoding", () => {
    expect(decodeUnicodeEscapes("a\\u4e3ab")).toBe("a为b");
  });

  it("returns empty string for empty string", () => {
    expect(decodeUnicodeEscapes("")).toBe("");
  });

  it("returns null and undefined unchanged", () => {
    expect(decodeUnicodeEscapes(null as unknown as string)).toBe(null);
    expect(decodeUnicodeEscapes(undefined as unknown as string)).toBe(
      undefined
    );
  });

  it("returns the original string when there are no escapes", () => {
    expect(decodeUnicodeEscapes("plain")).toBe("plain");
  });

  it("accepts uppercase and lowercase hex digits", () => {
    expect(decodeUnicodeEscapes("\\u00e9")).toBe("é");
    expect(decodeUnicodeEscapes("\\u00E9")).toBe("é");
  });
});

describe("decodeUnicodeEscapesDeep", () => {
  it("decodes string values", () => {
    expect(decodeUnicodeEscapesDeep("\\u4e3a")).toBe("为");
  });

  it("decodes each string in an array", () => {
    expect(decodeUnicodeEscapesDeep(["\\u4e3a", "x"])).toEqual(["为", "x"]);
  });

  it("decodes strings in nested objects", () => {
    expect(decodeUnicodeEscapesDeep({ nested: { s: "\\u4e3a" } })).toEqual({
      nested: { s: "为" },
    });
  });

  it("returns null and undefined unchanged", () => {
    expect(decodeUnicodeEscapesDeep(null)).toBe(null);
    expect(decodeUnicodeEscapesDeep(undefined)).toBe(undefined);
  });

  it("returns numbers and booleans unchanged", () => {
    expect(decodeUnicodeEscapesDeep(42)).toBe(42);
    expect(decodeUnicodeEscapesDeep(true)).toBe(true);
  });

  it("handles deeply nested mixed structures", () => {
    const input = {
      list: [{ t: "\\u4e3a" }, "\\u4e86"],
      n: 1,
      flag: false,
    };
    expect(decodeUnicodeEscapesDeep(input)).toEqual({
      list: [{ t: "为" }, "了"],
      n: 1,
      flag: false,
    });
  });
});
