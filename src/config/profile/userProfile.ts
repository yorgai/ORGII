export const TECH_SAVVY_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
] as const;

export type TechSavvyLevel = (typeof TECH_SAVVY_LEVELS)[number];
export type UserTechSavvySelection = TechSavvyLevel | "";

export const FAMILIAR_LANGUAGE_TECH_STACKS = [
  "JavaScript",
  "TypeScript",
  "React",
  "Next.js",
  "Vue",
  "Svelte",
  "Node.js",
  "Python",
  "Rust",
  "Go",
  "Java",
  "Kotlin",
  "Swift",
  "C++",
  "C#",
  "PHP",
  "Ruby",
  "SQL",
  "PostgreSQL",
  "MySQL",
  "SQLite",
  "Redis",
  "Docker",
  "Kubernetes",
  "AWS",
  "Azure",
  "GCP",
  "Tauri",
  "Electron",
  "React Native",
  "Flutter",
  "Tailwind CSS",
  "GraphQL",
  "REST API",
] as const;

export type FamiliarLanguageTechStack =
  (typeof FAMILIAR_LANGUAGE_TECH_STACKS)[number];
