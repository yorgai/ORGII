import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { type ProjectOrg, projectApi } from "@src/api/http/project";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import Modal from "@src/scaffold/ModalSystem";

const PROJECT_ORG_CREATE_MODAL_CLASS =
  "!w-[min(420px,calc(100vw-64px))] !bg-bg-2";

interface ProjectOrgCreateModalFormProps {
  error: string | null;
  gitFolderPath: string;
  name: string;
  onGitFolderPathChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
}

const ProjectOrgCreateModalForm: React.FC<ProjectOrgCreateModalFormProps> = ({
  error,
  gitFolderPath,
  name,
  onGitFolderPathChange,
  onNameChange,
  onSubmit,
}) => {
  const { t } = useTranslation(["projects", "common"]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") onSubmit();
    },
    [onSubmit]
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="px-1 text-sm text-text-3">
        {t("projects:orgs.createOrgHint")}
      </p>
      <SectionContainer>
        <SectionRow label={t("projects:orgs.orgName")} required>
          <Input
            autoFocus
            value={name}
            placeholder={t("projects:orgs.orgNamePlaceholder")}
            onChange={onNameChange}
            onKeyDown={handleKeyDown}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
        <SectionRow
          label={t("projects:orgs.gitFolderPath")}
          description={t("projects:orgs.gitFolderPathHint")}
        >
          <Input
            value={gitFolderPath}
            placeholder={t("projects:orgs.gitFolderPathPlaceholder")}
            onChange={onGitFolderPathChange}
            onKeyDown={handleKeyDown}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </SectionContainer>
      {error && (
        <InlineAlert type="danger" title={t("projects:orgs.createOrgFailed")}>
          {error}
        </InlineAlert>
      )}
    </div>
  );
};

export interface ProjectOrgCreateModalProps {
  open: boolean;
  onClose: () => void;
  onOrgCreated: (org: ProjectOrg) => void;
}

const ProjectOrgCreateModal: React.FC<ProjectOrgCreateModalProps> = ({
  open,
  onClose,
  onOrgCreated,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  const [name, setName] = useState("");
  const [gitFolderPath, setGitFolderPath] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName("");
    setGitFolderPath("");
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;

    setSaving(true);
    setError(null);
    try {
      const org = await projectApi.createOrg({ name: trimmedName });
      const trimmedGitFolderPath = gitFolderPath.trim();
      const configuredOrg = trimmedGitFolderPath
        ? await projectApi.configureOrgGitFolderSync({
            org_id: org.id,
            folder_path: trimmedGitFolderPath,
          })
        : org;
      onOrgCreated(configuredOrg);
      resetForm();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("projects:orgs.createOrgFailed")
      );
    } finally {
      setSaving(false);
    }
  }, [gitFolderPath, name, onOrgCreated, resetForm, saving, t]);

  return (
    <Modal
      visible={open}
      onClose={handleClose}
      onCancel={handleClose}
      onOk={handleSubmit}
      title={t("projects:orgs.createOrg")}
      okText={t("common:actions.create")}
      cancelText={t("common:actions.cancel")}
      okButtonProps={{ disabled: !name.trim() || saving, loading: saving }}
      cancelButtonProps={{ disabled: saving }}
      radius={12}
      className={PROJECT_ORG_CREATE_MODAL_CLASS}
    >
      {open && (
        <ProjectOrgCreateModalForm
          error={error}
          gitFolderPath={gitFolderPath}
          name={name}
          onGitFolderPathChange={setGitFolderPath}
          onNameChange={setName}
          onSubmit={() => void handleSubmit()}
        />
      )}
    </Modal>
  );
};

export default ProjectOrgCreateModal;
