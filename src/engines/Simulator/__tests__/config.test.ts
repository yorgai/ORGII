import { vi } from "vitest";

import { calculateAutoLayout, getLayoutCells } from "../config";

// Vitest validates named exports on the mock; a bare Proxy has no enumerable keys.
// vi.hoisted: mock factory runs before imports; non-hoisted consts are TDZ here.
const { lucideReactStubs } = vi.hoisted(() => ({
  lucideReactStubs: {
    Activity: "Activity",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Bug: "Bug",
    ChevronDown: "ChevronDown",
    Clock: "Clock",
    Code: "Code",
    Database: "Database",
    Eye: "Eye",
    File: "File",
    FileEdit: "FileEdit",
    FilePlus: "FilePlus",
    FolderSearch: "FolderSearch",
    Globe: "Globe",
    LayoutGrid: "LayoutGrid",
    LayoutList: "LayoutList",
    Link: "Link",
    Lock: "Lock",
    MapPin: "MapPin",
    MessageSquare: "MessageSquare",
    Monitor: "Monitor",
    Pause: "Pause",
    Phone: "Phone",
    Play: "Play",
    PlayCircle: "PlayCircle",
    Rewind: "Rewind",
    Save: "Save",
    Search: "Search",
    Server: "Server",
    Settings: "Settings",
    SkipBack: "SkipBack",
    SkipForward: "SkipForward",
    Square: "Square",
    SquareStack: "SquareStack",
    StopCircle: "StopCircle",
    Terminal: "Terminal",
    Wrench: "Wrench",
    Zap: "Zap",
  } as const,
}));

vi.mock("lucide-react", () => ({ ...lucideReactStubs }));
vi.mock("@src/store/ui/simulatorAtom", () => ({ SimulatorGridLayout: {} }));

describe("calculateAutoLayout", () => {
  it("maps task counts to grid layouts", () => {
    expect(calculateAutoLayout(0)).toBe("1x1");
    expect(calculateAutoLayout(1)).toBe("1x1");
    expect(calculateAutoLayout(2)).toBe("1x2");
    expect(calculateAutoLayout(3)).toBe("2x2");
    expect(calculateAutoLayout(4)).toBe("2x2");
    expect(calculateAutoLayout(5)).toBe("2x3");
    expect(calculateAutoLayout(6)).toBe("2x3");
    expect(calculateAutoLayout(7)).toBe("4x2");
    expect(calculateAutoLayout(8)).toBe("4x2");
    expect(calculateAutoLayout(9)).toBe("3x3");
    expect(calculateAutoLayout(10)).toBe("3x4");
    expect(calculateAutoLayout(12)).toBe("3x4");
  });
});

describe("getLayoutCells", () => {
  it("returns row × col for each layout key", () => {
    expect(getLayoutCells("1x1")).toBe(1);
    expect(getLayoutCells("1x2")).toBe(2);
    expect(getLayoutCells("2x2")).toBe(4);
    expect(getLayoutCells("2x3")).toBe(6);
    expect(getLayoutCells("3x3")).toBe(9);
    expect(getLayoutCells("4x2")).toBe(8);
    expect(getLayoutCells("3x4")).toBe(12);
  });
});
