import { useCallback, useState } from "react";

interface UseProjectManagerCreateModalsReturn {
  orgCreateModalOpen: boolean;
  openOrgCreateModal: () => void;
  closeOrgCreateModal: () => void;
}

export function useProjectManagerCreateModals(): UseProjectManagerCreateModalsReturn {
  const [orgCreateModalOpen, setOrgCreateModalOpen] = useState(false);

  const openOrgCreateModal = useCallback(() => {
    setOrgCreateModalOpen(true);
  }, []);

  const closeOrgCreateModal = useCallback(() => {
    setOrgCreateModalOpen(false);
  }, []);

  return {
    orgCreateModalOpen,
    openOrgCreateModal,
    closeOrgCreateModal,
  };
}
