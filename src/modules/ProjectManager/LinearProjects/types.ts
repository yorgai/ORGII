export interface ProjectDraft {
  name: string;
  description: string;
  teamId: string;
}

export interface IssueDraft {
  title: string;
  description: string;
}

export const EMPTY_PROJECT_DRAFT: ProjectDraft = {
  name: "",
  description: "",
  teamId: "",
};

export const EMPTY_ISSUE_DRAFT: IssueDraft = {
  title: "",
  description: "",
};
