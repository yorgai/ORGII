/**
 * SetupWalkthrough step configuration
 */
import {
  FolderGit2,
  Github,
  IdCard,
  Palette,
  Rocket,
  Sparkles,
} from "lucide-react";

import {
  CompleteStep,
  DevPassportStep,
  GitHubStep,
  RepoStep,
  ThemeSelectionStep,
  WelcomeStep,
} from "./steps";
import type { StepConfig } from "./types";

// ============================================
// Step Configurations
// ============================================

export const STEP_CONFIGS: StepConfig[] = [
  {
    id: "welcome",
    i18nKey: "welcome",
    icon: Sparkles,
    content: <WelcomeStep />,
  },
  {
    id: "theme",
    i18nKey: "theme",
    icon: Palette,
    content: <ThemeSelectionStep />,
  },
  {
    id: "dev-passport",
    i18nKey: "devPassport",
    icon: IdCard,
    content: <DevPassportStep />,
  },
  {
    id: "github",
    i18nKey: "github",
    icon: Github,
    content: <GitHubStep />,
  },
  {
    id: "workspace",
    i18nKey: "workspace",
    icon: FolderGit2,
    content: <RepoStep />,
  },
  {
    id: "complete",
    i18nKey: "complete",
    icon: Rocket,
    content: <CompleteStep />,
  },
];
