import { useSetAtom } from "jotai";
import { useCallback, useState } from "react";

import { removeProjectDraftAtom } from "@src/store/workstation/projectManager";

export const STORY_CREATE_MODAL_DRAFT_ID = "project-create-modal";

interface UseProjectManagerCreateModalsReturn {
  projectCreateModalOpen: boolean;
  orgCreateModalOpen: boolean;
  activeProjectCreateDraftId: string | null;
  openProjectCreateModal: () => void;
  closeProjectCreateModal: () => void;
  openOrgCreateModal: () => void;
  closeOrgCreateModal: () => void;
}

export function useProjectManagerCreateModals(): UseProjectManagerCreateModalsReturn {
  const [projectCreateModalOpen, setProjectCreateModalOpen] = useState(false);
  const [orgCreateModalOpen, setOrgCreateModalOpen] = useState(false);
  const removeProjectDraft = useSetAtom(removeProjectDraftAtom);

  const openProjectCreateModal = useCallback(() => {
    setOrgCreateModalOpen(false);
    setProjectCreateModalOpen(true);
  }, []);

  const closeProjectCreateModal = useCallback(() => {
    removeProjectDraft(STORY_CREATE_MODAL_DRAFT_ID);
    setProjectCreateModalOpen(false);
  }, [removeProjectDraft]);

  const openOrgCreateModal = useCallback(() => {
    setProjectCreateModalOpen(false);
    setOrgCreateModalOpen(true);
  }, []);

  const closeOrgCreateModal = useCallback(() => {
    setOrgCreateModalOpen(false);
  }, []);

  return {
    projectCreateModalOpen,
    orgCreateModalOpen,
    activeProjectCreateDraftId: projectCreateModalOpen
      ? STORY_CREATE_MODAL_DRAFT_ID
      : null,
    openProjectCreateModal,
    closeProjectCreateModal,
    openOrgCreateModal,
    closeOrgCreateModal,
  };
}
