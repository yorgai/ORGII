import { classNames } from "../classNames";

describe("classNames", () => {
  it("joins truthy string arguments with a single space", () => {
    expect(classNames("foo", "bar")).toBe("foo bar");
  });

  it("filters out falsy values", () => {
    expect(classNames("foo", null, undefined, false, "", "bar")).toBe(
      "foo bar"
    );
  });

  it("returns empty string when no truthy classes", () => {
    expect(classNames()).toBe("");
  });

  it("handles mixed booleans and strings", () => {
    expect(classNames("a", true && "b", false && "c", "d")).toBe("a b d");
  });
});
