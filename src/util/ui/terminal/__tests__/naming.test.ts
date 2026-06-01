import {
  defaultTerminalLabelBaseFromSettings,
  generateUniqueLabelFromBase,
  resolveTerminalDisplayName,
  shellPathToTerminalLabel,
} from "../naming";

describe("shellPathToTerminalLabel", () => {
  it("returns Terminal for empty or whitespace input", () => {
    expect(shellPathToTerminalLabel("")).toBe("Terminal");
    expect(shellPathToTerminalLabel("   ")).toBe("Terminal");
  });

  it("uses the basename from POSIX or Windows paths", () => {
    expect(shellPathToTerminalLabel("/bin/zsh")).toBe("zsh");
    expect(
      shellPathToTerminalLabel("C:\\Program Files\\Git\\bin\\bash.exe")
    ).toBe("bash");
  });

  it("returns the segment when there is no path separator", () => {
    expect(shellPathToTerminalLabel("pwsh")).toBe("pwsh");
  });
});

describe("generateUniqueLabelFromBase", () => {
  it("returns trimmed base when unused", () => {
    expect(generateUniqueLabelFromBase("zsh", ["bash"])).toBe("zsh");
  });

  it("appends incrementing suffixes until unique", () => {
    expect(generateUniqueLabelFromBase("zsh", ["zsh", "zsh 2"])).toBe("zsh 3");
  });

  it("uses Terminal when base is blank", () => {
    expect(generateUniqueLabelFromBase("   ", ["Terminal"])).toBe("Terminal 2");
  });
});

describe("defaultTerminalLabelBaseFromSettings", () => {
  it("returns Terminal when shell type is not custom", () => {
    expect(
      defaultTerminalLabelBaseFromSettings({
        "terminal.shellType": "default",
        "terminal.customShellPath": "",
      })
    ).toBe("Terminal");
  });

  it("uses basename of custom shell path when shell type is custom", () => {
    expect(
      defaultTerminalLabelBaseFromSettings({
        "terminal.shellType": "custom",
        "terminal.customShellPath": "/usr/local/bin/fish",
      })
    ).toBe("fish");
  });

  it("returns Terminal when custom path is missing or blank", () => {
    expect(
      defaultTerminalLabelBaseFromSettings({
        "terminal.shellType": "custom",
        "terminal.customShellPath": "   ",
      })
    ).toBe("Terminal");
  });
});

describe("resolveTerminalDisplayName", () => {
  it("prefers explicit trimmed name", () => {
    expect(
      resolveTerminalDisplayName(
        { name: "  My Tab  ", shell: "/bin/zsh" },
        [],
        "Terminal"
      )
    ).toBe("My Tab");
  });

  it("derives from shell when name is absent", () => {
    expect(
      resolveTerminalDisplayName({ shell: "/bin/bash" }, ["bash"], "Terminal")
    ).toBe("bash 2");
  });

  it("uses uniquified default base from settings when no name or shell", () => {
    expect(
      resolveTerminalDisplayName(undefined, ["Terminal"], "Terminal")
    ).toBe("Terminal 2");
  });
});
