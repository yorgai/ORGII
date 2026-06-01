/**
 * Shared types for ComponentPreviewContent
 */
import type {
  ComponentDetails,
  PropInfo,
} from "@src/modules/WorkStation/Browser/hooks/useComponentCatalog";
import type {
  ProjectFileInfo,
  ProjectInfo,
} from "@src/modules/WorkStation/Browser/hooks/useOrgiiProjects";
import type { ComponentPreviewData } from "@src/store/workstation/browser/tabs";

export interface ComponentPreviewPanelProps {
  /** The component preview entry */
  preview: ComponentPreviewData;
  /** Component details with extracted props (from lazy extraction) */
  details: ComponentDetails | null;
  /** Project file info (if previewing a storybook component) */
  projectFile?: ProjectFileInfo | null;
  /** Currently selected project */
  selectedProject?: ProjectInfo | null;
  /** Callback when project selection changes */
  onSelectProject?: (project: ProjectInfo) => void;
  /** Whether props are still being extracted */
  isLoading?: boolean;
  /** Open source file at line */
  onOpenSource?: (filePath: string, line: number) => void;
  /** Refresh/re-extract props */
  onRefresh?: () => void;
  /** Repository path for loading component styles */
  repoPath?: string;
}

export interface PropEditorProps {
  prop: PropInfo;
  value: unknown;
  onChange: (value: unknown) => void;
}

export interface PropsPanelProps {
  props: PropInfo[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
}

export interface PreviewWebviewProps {
  componentName: string;
  componentPath: string;
  projectName: string | null;
  propValues: Record<string, unknown>;
  /** CSS to inject into preview (e.g., design tokens) */
  tokenCSS?: string;
  /** Repository path for loading component styles (SCSS/CSS) */
  repoPath?: string;
}

export type { ComponentDetails, PropInfo, ProjectFileInfo, ProjectInfo };
