import type { PillIconType } from "@src/components/ComposerInput";
import type { WorkStationTabType } from "@src/store/workstation/tabs";

export interface TabDragPillPayload {
  path: string;
  name?: string;
  iconType: PillIconType;
  isFolder?: boolean;
  tabType?: WorkStationTabType;
}

export interface TabDragEventDetail {
  tabId: string;
  filePath?: string;
  name?: string;
  type?: string;
  pill?: TabDragPillPayload;
  pointerX?: number;
  pointerY?: number;
}
