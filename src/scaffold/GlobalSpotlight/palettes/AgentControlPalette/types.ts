import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";

export type GuiControlRunStatus = "idle" | "sending" | "running" | "error";
export type GuiControlActivityStatus = "running" | "completed" | "failed";

export interface GuiControlSubmitDetail {
  text: string;
  modelSelection: LastModelSelection | null;
}

export interface GuiControlActivityItem {
  id: string;
  title: string;
  detail: string;
  status: GuiControlActivityStatus;
  isMarkdown?: boolean;
}
