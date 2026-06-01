/**
 * Project Manager Shared Components
 *
 * Components shared between Projects and WorkItem modules.
 */
export { default as ClaimIdentityModal } from "./ClaimIdentityModal";
export type { ClaimIdentityModalProps } from "./ClaimIdentityModal";
export { default as DetailSplitLayout } from "./DetailSplitLayout";
export type { DetailSplitLayoutProps } from "./DetailSplitLayout";
export { default as InlineDropdown } from "./InlineDropdown";
export { default as ProjectContentEditor } from "./ProjectContentEditor";
export type {
  ProjectContentEditorRef,
  ProjectContentEditorProps,
} from "./ProjectContentEditor";
export { default as PropertiesPanel } from "./PropertiesPanel";
export { default as PropertiesRailFrame } from "./PropertiesPanel/PropertiesRailFrame";
export type { PropertiesPanelShellProps } from "./PropertiesPanel";
export type {
  LinkedRepoOption,
  ProjectData,
  PropertiesPanelProps,
} from "./PropertiesPanel";
export {
  default as ProjectPropertyFields,
  PROJECT_PROPERTY_CONCISE_FIELDS,
} from "./PropertiesPanel/ProjectPropertyFields";
export type { ProjectPropertyFieldsProps } from "./PropertiesPanel/ProjectPropertyFields";
