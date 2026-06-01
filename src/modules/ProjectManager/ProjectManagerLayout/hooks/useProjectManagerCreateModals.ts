import { useSetAtom } from "jotai";
import { useCallback, useState } from "react";

import { WORK_ITEM_CREATOR_DRAFT_ID } from "@src/hooks/project";
import { removeProjectDraftAtom } from "@src/store/workstation/projectManager";

import type { CreateWorkItemModalState } from "../types";

export const STORY_CREATE_MODAL_DRAFT_ID = "project-create-modal";

interface UseProjectManagerCreateModalsReturn {
  projectCreateModalOpen: boolean;
  orgCreateModalOpen: boolean;
  workItemCreateModal: CreateWorkItemModalState | null;
  activeProjectCreateDraftId: string | null;
  activeWorkItemCreateDraftId: string | null;
  openProjectCreateModal: () => void;
  closeProjectCreateModal: () => void;
  openOrgCreateModal: () => void;
  closeOrgCreateModal: () => void;
  openWorkItemCreateModal: (
    projectId?: string,
    projectName?: string,
    projectSlug?: string
  ) => void;
  closeWorkItemCreateModal: () => void;
}

export function useProjectManagerCreateModals(): UseProjectManagerCreateModalsReturn {
  const [projectCreateModalOpen, setProjectCreateModalOpen] = useState(false);
  const [orgCreateModalOpen, setOrgCreateModalOpen] = useState(false);
  const [workItemCreateModal, setWorkItemCreateModal] =
    useState<CreateWorkItemModalState | null>(null);
  const removeProjectDraft = useSetAtom(removeProjectDraftAtom);

  const openProjectCreateModal = useCallback(() => {
    setOrgCreateModalOpen(false);
    setWorkItemCreateModal(null);
    setProjectCreateModalOpen(true);
  }, []);

  const closeProjectCreateModal = useCallback(() => {
    removeProjectDraft(STORY_CREATE_MODAL_DRAFT_ID);
    setProjectCreateModalOpen(false);
  }, [removeProjectDraft]);

  const openOrgCreateModal = useCallback(() => {
    setProjectCreateModalOpen(false);
    setWorkItemCreateModal(null);
    setOrgCreateModalOpen(true);
  }, []);

  const closeOrgCreateModal = useCallback(() => {
    setOrgCreateModalOpen(false);
  }, []);

  const openWorkItemCreateModal = useCallback(
    (projectId?: string, projectName?: string, projectSlug?: string) => {
      setProjectCreateModalOpen(false);
      setOrgCreateModalOpen(false);
      setWorkItemCreateModal({
        projectId,
        projectName,
        projectSlug,
      });
    },
    []
  );

  const closeWorkItemCreateModal = useCallback(() => {
    setWorkItemCreateModal(null);
  }, []);

  return {
    projectCreateModalOpen,
    orgCreateModalOpen,
    workItemCreateModal,
    activeProjectCreateDraftId: projectCreateModalOpen
      ? STORY_CREATE_MODAL_DRAFT_ID
      : null,
    activeWorkItemCreateDraftId: workItemCreateModal
      ? WORK_ITEM_CREATOR_DRAFT_ID
      : null,
    openProjectCreateModal,
    closeProjectCreateModal,
    openOrgCreateModal,
    closeOrgCreateModal,
    openWorkItemCreateModal,
    closeWorkItemCreateModal,
  };
}
