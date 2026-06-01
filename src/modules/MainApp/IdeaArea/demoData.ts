/**
 * Demo data for Idea Area views.
 */

export type IdeaCategory =
  | "productivity"
  | "dev-tools"
  | "ai"
  | "collaboration"
  | "utilities"
  | "creative";

export type IdeaStatus = "concept" | "in-progress" | "shipped";

export interface IdeaItem {
  id: string;
  title: string;
  description: string;
  category: IdeaCategory;
  upvotes: number;
  comments: number;
  authorName: string;
  authorHandle: string;
  createdAt: string;
  tags: string[];
  status: IdeaStatus;
  trending?: boolean;
}

export const TRENDING_IDEAS: IdeaItem[] = [
  {
    id: "t1",
    title: "AI-powered commit message generator",
    description:
      "Automatically generate semantic commit messages by analyzing your staged diff. Supports Conventional Commits and custom formats.",
    category: "dev-tools",
    upvotes: 847,
    comments: 64,
    authorName: "Lucas Meyer",
    authorHandle: "@lucasdev",
    createdAt: "2026-04-15",
    tags: ["git", "ai", "automation"],
    status: "in-progress",
    trending: true,
  },
  {
    id: "t2",
    title: "Focus session tracker with Pomodoro + deep work analytics",
    description:
      "Track Pomodoro sessions alongside your coding heartbeats. Visualize when you enter deep-flow states and how interruptions affect output.",
    category: "productivity",
    upvotes: 612,
    comments: 41,
    authorName: "Yuki Tanaka",
    authorHandle: "@yukicode",
    createdAt: "2026-04-14",
    tags: ["focus", "analytics", "pomodoro"],
    status: "concept",
    trending: true,
  },
  {
    id: "t3",
    title: "Shared workspace snapshot — send a full context link",
    description:
      "Create a shareable link that captures your current editor state: open files, cursor positions, terminal output, and active session. No more long screen-share calls.",
    category: "collaboration",
    upvotes: 589,
    comments: 57,
    authorName: "Priya Nair",
    authorHandle: "@priya_builds",
    createdAt: "2026-04-13",
    tags: ["sharing", "collaboration", "context"],
    status: "concept",
    trending: true,
  },
  {
    id: "t4",
    title: "Inline SQL query explainer",
    description:
      "Hover over any SQL query in your editor and get a plain-English explanation, estimated row counts, and optimization suggestions from the AI.",
    category: "dev-tools",
    upvotes: 430,
    comments: 33,
    authorName: "Marco Vitale",
    authorHandle: "@marco_sql",
    createdAt: "2026-04-12",
    tags: ["sql", "ai", "editor"],
    status: "concept",
  },
  {
    id: "t5",
    title: "Agent task marketplace — outsource background jobs",
    description:
      "Post repetitive coding tasks (test writing, doc generation, migration scripts) to a pool of AI agents and get results back asynchronously.",
    category: "ai",
    upvotes: 391,
    comments: 28,
    authorName: "Sofia Chen",
    authorHandle: "@sofiaai",
    createdAt: "2026-04-11",
    tags: ["agents", "marketplace", "async"],
    status: "in-progress",
  },
  {
    id: "t6",
    title: "Live PR review co-pilot",
    description:
      "Real-time AI co-pilot during PR review: flags security concerns, suggests tests, checks for breaking changes, and drafts inline comments.",
    category: "ai",
    upvotes: 315,
    comments: 22,
    authorName: "James Kim",
    authorHandle: "@jkim_dev",
    createdAt: "2026-04-10",
    tags: ["pr", "ai", "review"],
    status: "concept",
  },
];

export const SHARED_IDEAS: IdeaItem[] = [
  {
    id: "s1",
    title: "One-click env setup from README",
    description:
      "Parse a project's README and automatically configure environment variables, install dependencies, and run setup scripts.",
    category: "dev-tools",
    upvotes: 278,
    comments: 19,
    authorName: "Amara Osei",
    authorHandle: "@amara_dev",
    createdAt: "2026-04-16",
    tags: ["env", "setup", "automation"],
    status: "concept",
  },
  {
    id: "s2",
    title: "Cross-session memory for AI agents",
    description:
      "Agents remember decisions made in previous sessions — architecture choices, naming conventions, known bugs — so you never repeat context.",
    category: "ai",
    upvotes: 245,
    comments: 31,
    authorName: "Reza Moradi",
    authorHandle: "@rezaai",
    createdAt: "2026-04-15",
    tags: ["memory", "agents", "context"],
    status: "in-progress",
  },
  {
    id: "s3",
    title: "Visual diff for JSON / YAML config files",
    description:
      "Side-by-side visual diff that understands the schema of config files — highlights semantic changes, not just text changes.",
    category: "dev-tools",
    upvotes: 210,
    comments: 14,
    authorName: "Natalia Sousa",
    authorHandle: "@nataliadev",
    createdAt: "2026-04-14",
    tags: ["diff", "config", "yaml"],
    status: "shipped",
  },
  {
    id: "s4",
    title: "Team coding velocity dashboard",
    description:
      "Aggregate coding activity across a team — show velocity trends, identify blockers, highlight top contributors without micromanaging.",
    category: "collaboration",
    upvotes: 198,
    comments: 26,
    authorName: "Oscar Lindqvist",
    authorHandle: "@oscar_eng",
    createdAt: "2026-04-13",
    tags: ["team", "analytics", "dashboard"],
    status: "concept",
  },
  {
    id: "s5",
    title: "Snippet library with fuzzy search and AI tagging",
    description:
      "Save code snippets across projects. AI auto-tags them. Fuzzy search finds the right snippet instantly, even if you remember it vaguely.",
    category: "productivity",
    upvotes: 176,
    comments: 11,
    authorName: "Elena Vasquez",
    authorHandle: "@elena_codes",
    createdAt: "2026-04-12",
    tags: ["snippets", "search", "ai"],
    status: "concept",
  },
];

export const MY_IDEAS: IdeaItem[] = [
  {
    id: "m1",
    title: "Custom hotkey profiles per project",
    description:
      "Save and restore keybinding profiles per project. Switch automatically when you open a new repo.",
    category: "utilities",
    upvotes: 42,
    comments: 5,
    authorName: "You",
    authorHandle: "@me",
    createdAt: "2026-04-17",
    tags: ["hotkeys", "profiles", "ux"],
    status: "concept",
  },
  {
    id: "m2",
    title: "Regex playground with live test strings",
    description:
      "Inline regex testing panel. Enter test strings, see match groups highlighted in real-time, and export the final pattern with a comment.",
    category: "dev-tools",
    upvotes: 18,
    comments: 2,
    authorName: "You",
    authorHandle: "@me",
    createdAt: "2026-04-10",
    tags: ["regex", "playground", "tools"],
    status: "in-progress",
  },
  {
    id: "m3",
    title: "Background task runner with progress notifications",
    description:
      "Long-running scripts (test suites, builds) run in the background and notify you with a subtle badge when done — no terminal watching needed.",
    category: "productivity",
    upvotes: 9,
    comments: 1,
    authorName: "You",
    authorHandle: "@me",
    createdAt: "2026-04-05",
    tags: ["tasks", "notifications", "background"],
    status: "concept",
  },
];

export const CATEGORY_LABELS: Record<IdeaCategory, string> = {
  productivity: "Productivity",
  "dev-tools": "Dev Tools",
  ai: "AI",
  collaboration: "Collaboration",
  utilities: "Utilities",
  creative: "Creative",
};

export const STATUS_LABELS: Record<IdeaStatus, string> = {
  concept: "Concept",
  "in-progress": "In Progress",
  shipped: "Shipped",
};
