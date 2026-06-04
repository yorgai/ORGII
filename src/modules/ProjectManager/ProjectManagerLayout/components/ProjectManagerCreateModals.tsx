import React, { Suspense, useEffect } from "react";

import type { ProjectOrg } from "@src/api/http/project";
import Modal from "@src/scaffold/ModalSystem";

import { STORY_CREATE_MODAL_DRAFT_ID } from "../hooks/useProjectManagerCreateModals";
import { STORY_MANAGER_SUSPENSE_LOADING_FALLBACK } from "./ProjectManagerContentRouter";
import ProjectOrgCreateModal from "./ProjectOrgCreateModal";

// Keep the loader thunks as named constants so we can both feed them to
// `React.lazy` and fire them eagerly from a `useEffect` below. Without the
// eager prefetch, the first click on "New Project" triggers a cold
// webpack chunk download which surfaces as a long Suspense spinner. The chunk is
// cached on subsequent opens, hence the "first time slow, second time
// instant" behavior. The prefetch warms the cache while the user is still
// browsing the project list.
const loadCreateProjectView = () =>
  import("../../Projects/components/CreateProjectView");

const CreateProjectView = React.lazy(loadCreateProjectView);

/**
 * Schedule a lazy-chunk preload during browser idle time. Falls back to a
 * short timeout when `requestIdleCallback` is unavailable (Safari/WKWebView).
 */
function schedulePrefetch(load: () => Promise<unknown>): () => void {
  type IdleHandle = number;
  type IdleCallback = (deadline: { didTimeout: boolean }) => void;
  interface IdleWindow {
    requestIdleCallback?: (
      cb: IdleCallback,
      opts?: { timeout: number }
    ) => IdleHandle;
    cancelIdleCallback?: (handle: IdleHandle) => void;
  }
  const idleWin = window as unknown as IdleWindow;

  // Swallow the prefetch error — the real mount will surface it via Suspense.
  const run = () => {
    void load().catch(() => undefined);
  };

  if (typeof idleWin.requestIdleCallback === "function") {
    const handle = idleWin.requestIdleCallback(run, { timeout: 2000 });
    return () => idleWin.cancelIdleCallback?.(handle);
  }

  const timer = window.setTimeout(run, 500);
  return () => window.clearTimeout(timer);
}

const CREATE_MODAL_STYLE: React.CSSProperties = {
  width: "min(900px, calc(100vw - 96px))",
  height: "min(600px, calc(100vh - 96px))",
};

const CREATE_MODAL_CLASS = "!bg-bg-2";
const CREATE_MODAL_BODY_CLASS = "flex min-h-0 flex-col overflow-hidden p-0";
const CREATE_MODAL_VIEW_CLASS = "flex min-h-0 flex-1 overflow-hidden";

interface ProjectManagerCreateModalsProps {
  repoPath: string;
  repoName: string;
  projectCreateModalOpen: boolean;
  orgCreateModalOpen: boolean;
  scopeBreadcrumbLabel?: string;
  projectCreateOrgId: string;
  onCloseProjectCreateModal: () => void;
  onCloseOrgCreateModal: () => void;
  onProjectCreated: (options?: { keepOpen?: boolean }) => void;
  onOrgCreated: (org: ProjectOrg) => void;
}

export function ProjectManagerCreateModals({
  repoPath,
  repoName,
  projectCreateModalOpen,
  orgCreateModalOpen,
  scopeBreadcrumbLabel,
  projectCreateOrgId,
  onCloseProjectCreateModal,
  onCloseOrgCreateModal,
  onProjectCreated,
  onOrgCreated,
}: ProjectManagerCreateModalsProps) {
  useEffect(() => {
    const cancelProject = schedulePrefetch(loadCreateProjectView);
    return () => {
      cancelProject();
    };
  }, []);

  return (
    <>
      <Modal
        visible={projectCreateModalOpen}
        onClose={onCloseProjectCreateModal}
        footer={null}
        closable={false}
        maskClosable={false}
        radius={12}
        style={CREATE_MODAL_STYLE}
        className={CREATE_MODAL_CLASS}
        bodyClassName={CREATE_MODAL_BODY_CLASS}
      >
        {projectCreateModalOpen && (
          <Suspense fallback={STORY_MANAGER_SUSPENSE_LOADING_FALLBACK}>
            <div className={CREATE_MODAL_VIEW_CLASS}>
              <CreateProjectView
                tabId={STORY_CREATE_MODAL_DRAFT_ID}
                repoPath={repoPath}
                repoName={repoName}
                scopeBreadcrumbLabel={scopeBreadcrumbLabel}
                orgId={projectCreateOrgId}
                onCancel={onCloseProjectCreateModal}
                onSetUnsaved={() => undefined}
                onProjectCreated={onProjectCreated}
              />
            </div>
          </Suspense>
        )}
      </Modal>

      <ProjectOrgCreateModal
        open={orgCreateModalOpen}
        onClose={onCloseOrgCreateModal}
        onOrgCreated={onOrgCreated}
      />
    </>
  );
}
