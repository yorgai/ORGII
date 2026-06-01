import { snakeToCamel } from "../transforms";

describe("snakeToCamel", () => {
  it("converts simple object keys", () => {
    expect(snakeToCamel({ hello_world: 1 })).toEqual({ helloWorld: 1 });
  });

  it("converts nested objects", () => {
    expect(snakeToCamel({ outer_key: { inner_key: "v" } })).toEqual({
      outerKey: { innerKey: "v" },
    });
  });

  it("converts arrays of objects", () => {
    expect(snakeToCamel([{ my_key: 1 }])).toEqual([{ myKey: 1 }]);
  });

  it("leaves camelCase keys unchanged", () => {
    expect(snakeToCamel({ alreadyCamel: 2 })).toEqual({ alreadyCamel: 2 });
  });

  it("returns null and undefined as-is", () => {
    expect(snakeToCamel(null)).toBeNull();
    expect(snakeToCamel(undefined)).toBeUndefined();
  });

  it("returns primitives as-is", () => {
    expect(snakeToCamel("x")).toBe("x");
    expect(snakeToCamel(42)).toBe(42);
    expect(snakeToCamel(true)).toBe(true);
  });

  it("returns empty object", () => {
    expect(snakeToCamel({})).toEqual({});
  });

  it("handles deep nesting with arrays", () => {
    expect(snakeToCamel({ a_b: { c_d: [{ e_f: true }] } })).toEqual({
      aB: { cD: [{ eF: true }] },
    });
  });

  it("handles multiple underscores in keys", () => {
    expect(snakeToCamel({ a_b_c: 1 })).toEqual({ aBC: 1 });
  });
});
