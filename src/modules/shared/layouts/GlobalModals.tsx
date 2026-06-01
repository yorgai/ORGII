/**
 * Global Modals Component
 *
 * Renders the global modals that appear across Orgii layouts
 *
 * Note: ApiCallsPanelProvider is rendered at the app level in App.tsx
 */
import LoginModal from "@/src/scaffold/ModalSystem/variants/Login";
import React from "react";

import { ComponentIssueModalProvider } from "@src/modules/shared/DevTools/ComponentIssueModal";

export const GlobalModals: React.FC = () => {
  return (
    <>
      <LoginModal />
      <ComponentIssueModalProvider />
    </>
  );
};
