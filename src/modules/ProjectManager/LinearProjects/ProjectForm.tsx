import { Save } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import type { LinearTeamSummary } from "@src/api/http/integrations";
import Button from "@src/components/Button";

import type { ProjectDraft } from "./types";

interface ProjectFormProps {
  draft: ProjectDraft;
  teams: LinearTeamSummary[];
  saving: boolean;
  submitLabel: string;
  hideTeamSelect?: boolean;
  onDraftChange: (draft: ProjectDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export const ProjectForm: React.FC<ProjectFormProps> = ({
  draft,
  teams,
  saving,
  submitLabel,
  hideTeamSelect = false,
  onDraftChange,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  return (
    <div className="mt-4 space-y-3">
      <input
        value={draft.name}
        onChange={(event) =>
          onDraftChange({ ...draft, name: event.target.value })
        }
        placeholder={t("linearProjects.forms.projectName")}
        className="h-9 w-full rounded-lg border border-border-1 bg-bg-1 px-3 text-sm outline-none focus:border-primary-5"
      />
      <textarea
        value={draft.description}
        onChange={(event) =>
          onDraftChange({ ...draft, description: event.target.value })
        }
        placeholder={t("linearProjects.forms.description")}
        className="min-h-[96px] w-full resize-y rounded-lg border border-border-1 bg-bg-1 px-3 py-2 text-sm outline-none focus:border-primary-5"
      />
      {!hideTeamSelect && (
        <select
          value={draft.teamId}
          onChange={(event) =>
            onDraftChange({ ...draft, teamId: event.target.value })
          }
          className="h-9 w-full rounded-lg border border-border-1 bg-bg-1 px-3 text-sm outline-none focus:border-primary-5"
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name} ({team.key})
            </option>
          ))}
        </select>
      )}
      <div className="flex justify-end gap-2">
        <Button
          size="small"
          variant="tertiary"
          appearance="ghost"
          onClick={onCancel}
        >
          {t("common:actions.cancel")}
        </Button>
        <Button
          size="small"
          variant="primary"
          appearance="solid"
          icon={<Save size={14} />}
          loading={saving}
          disabled={!draft.name.trim() || (!hideTeamSelect && !draft.teamId)}
          onClick={onSubmit}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
};
