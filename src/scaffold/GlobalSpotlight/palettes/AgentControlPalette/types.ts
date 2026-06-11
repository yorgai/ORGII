import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";

export type AdeManagerRunStatus = "idle" | "sending" | "running" | "error";
export type AdeManagerActivityStatus = "running" | "completed" | "failed";

export interface AdeManagerSubmitDetail {
  text: string;
  modelSelection: LastModelSelection | null;
}

export interface AdeManagerActivityItem {
  id: string;
  title: string;
  detail: string;
  status: AdeManagerActivityStatus;
  isMarkdown?: boolean;
}

/** @deprecated Use AdeManagerRunStatus */
export type GuiControlRunStatus = AdeManagerRunStatus;
/** @deprecated Use AdeManagerActivityStatus */
export type GuiControlActivityStatus = AdeManagerActivityStatus;
/** @deprecated Use AdeManagerSubmitDetail */
export type GuiControlSubmitDetail = AdeManagerSubmitDetail;
/** @deprecated Use AdeManagerActivityItem */
export type GuiControlActivityItem = AdeManagerActivityItem;
