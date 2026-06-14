/**
 * CreateCollabOrgView
 *
 * Empty shell for adding a collaboration org from the colleagues sidebar.
 * Uses the same DetailSplitLayout + chat panel footer pattern as create flows.
 */
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { DetailSplitLayout } from "@src/modules/ProjectManager/shared";

export interface CreateCollabOrgViewProps {
  onCancel: () => void;
}

const CreateCollabOrgView: React.FC<CreateCollabOrgViewProps> = ({
  onCancel,
}) => {
  const { t } = useTranslation(["navigation", "common"]);

  const handleSave = useCallback(() => {
    // Wired in a follow-up once hub/org form fields are implemented.
  }, []);

  return (
    <DetailSplitLayout
      title={t("navigation:collaboration.addOrg")}
      borderlessHeader
      hideHeader
      leftContent={
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-testid="create-collab-org-body"
        />
      }
      footer={
        <>
          <Button variant="secondary" size="small" onClick={onCancel}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={handleSave}
            disabled
            data-testid="create-collab-org-submit"
          >
            {t("common:actions.save")}
          </Button>
        </>
      }
    />
  );
};

export default CreateCollabOrgView;
