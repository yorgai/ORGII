import type React from "react";
import { useCallback } from "react";

import type { AddWorkspaceModalStage, useAddWorkspaceFlow } from "../../hooks";
import { importWorkspacePath, looksLikeWorkspacePath } from "./pathImport";
import type { AddMenuKind, WorkspacePaletteText } from "./types";

interface UseWorkspacePaletteNavigationArgs {
  modalStage: AddWorkspaceModalStage;
  addMenuKind: AddMenuKind;
  asBody: boolean;
  effectiveInitialStage: AddWorkspaceModalStage;
  initialAddMenu: boolean;
  onClose: () => void;
  onGoBackToParent?: () => void;
  setModalStage: (stage: AddWorkspaceModalStage) => void;
  setAddMenuKind: (kind: AddMenuKind) => void;
  setSearchQuery: (query: string) => void;
  addWorkspaceFlow: ReturnType<typeof useAddWorkspaceFlow>;
  searchQuery: string;
  paletteText: WorkspacePaletteText;
}

export function useWorkspacePaletteNavigation({
  modalStage,
  addMenuKind,
  asBody,
  effectiveInitialStage,
  initialAddMenu,
  onClose,
  onGoBackToParent,
  setModalStage,
  setAddMenuKind,
  setSearchQuery,
  addWorkspaceFlow,
  searchQuery,
  paletteText,
}: UseWorkspacePaletteNavigationArgs) {
  const shouldReturnInitialStageToParent =
    !!onGoBackToParent && !!effectiveInitialStage;
  const shouldReturnInitialAddMenuToParent =
    !!onGoBackToParent && initialAddMenu;

  const handleGoBack = useCallback(() => {
    if (modalStage) {
      if (
        modalStage === "create-workspace" &&
        effectiveInitialStage === "create-workspace"
      ) {
        setModalStage(null);
        setAddMenuKind("add");
        setSearchQuery("");
        return;
      }

      if (shouldReturnInitialStageToParent) {
        onGoBackToParent?.();
        return;
      }

      addWorkspaceFlow.handleGoBack();
      return;
    }

    if (addMenuKind) {
      if (shouldReturnInitialAddMenuToParent) {
        onGoBackToParent?.();
        return;
      }

      setAddMenuKind(null);
      setSearchQuery("");
      return;
    }

    if (onGoBackToParent) {
      onGoBackToParent();
      return;
    }

    if (asBody) {
      onClose();
    }
  }, [
    addMenuKind,
    addWorkspaceFlow,
    asBody,
    effectiveInitialStage,
    modalStage,
    onClose,
    onGoBackToParent,
    setAddMenuKind,
    setModalStage,
    setSearchQuery,
    shouldReturnInitialAddMenuToParent,
    shouldReturnInitialStageToParent,
  ]);

  const handlePathImportSubmit = useCallback(async () => {
    if (modalStage || addMenuKind) return false;

    return importWorkspacePath({
      candidatePath: searchQuery,
      invalidPathTitle: paletteText.invalidPathTitle,
      invalidPathMessage: paletteText.invalidPathMessage,
      onImportWorkspace:
        addWorkspaceFlow.localWorkspaceForm.handleImportWorkspace,
    });
  }, [
    addMenuKind,
    addWorkspaceFlow.localWorkspaceForm.handleImportWorkspace,
    modalStage,
    paletteText.invalidPathMessage,
    paletteText.invalidPathTitle,
    searchQuery,
  ]);

  const handleExternalKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement>,
      internal: (event: React.KeyboardEvent<HTMLInputElement>) => void
    ) => {
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        searchQuery === "" &&
        (!!modalStage || !!addMenuKind || asBody || !!onGoBackToParent)
      ) {
        event.preventDefault();
        handleGoBack();
        return;
      }

      if (event.key === "Enter" && looksLikeWorkspacePath(searchQuery)) {
        event.preventDefault();
        void handlePathImportSubmit();
        return;
      }

      internal(event);
    },
    [
      addMenuKind,
      asBody,
      handleGoBack,
      handlePathImportSubmit,
      modalStage,
      onGoBackToParent,
      searchQuery,
    ]
  );

  return {
    handleGoBack,
    handleExternalKeyDown,
  };
}
