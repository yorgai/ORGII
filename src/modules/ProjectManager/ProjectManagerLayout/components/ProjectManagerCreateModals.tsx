import type { ProjectOrg } from "@src/api/http/project";

import ProjectOrgCreateModal from "./ProjectOrgCreateModal";

interface ProjectManagerCreateModalsProps {
  orgCreateModalOpen: boolean;
  onCloseOrgCreateModal: () => void;
  onOrgCreated: (org: ProjectOrg) => void;
}

export function ProjectManagerCreateModals({
  orgCreateModalOpen,
  onCloseOrgCreateModal,
  onOrgCreated,
}: ProjectManagerCreateModalsProps) {
  return (
    <ProjectOrgCreateModal
      open={orgCreateModalOpen}
      onClose={onCloseOrgCreateModal}
      onOrgCreated={onOrgCreated}
    />
  );
}
