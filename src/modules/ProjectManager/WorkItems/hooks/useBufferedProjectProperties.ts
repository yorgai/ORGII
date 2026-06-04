import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProjectData } from "@src/modules/ProjectManager/shared";
import type { Person } from "@src/types/core/shared";

const STORY_UPDATE_DEBOUNCE_MS = 800;

interface UseBufferedProjectPropertiesOptions {
  projectId: string;
  sourceProject: ProjectData;
  onProjectUpdate: (updates: Partial<ProjectData>) => void;
  hasWorkItemPendingChanges: boolean;
  onSetUnsaved?: (hasUnsaved: boolean) => void;
  onProjectNameUpdated?: (projectName: string) => void;
}

export function useBufferedProjectProperties({
  projectId,
  sourceProject,
  onProjectUpdate,
  hasWorkItemPendingChanges,
  onSetUnsaved,
  onProjectNameUpdated,
}: UseBufferedProjectPropertiesOptions) {
  const [pendingProjectState, setPendingProjectState] = useState<{
    projectId: string;
    updates: Partial<ProjectData>;
  }>({ projectId, updates: {} });
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingProjectUpdates = useMemo(
    () =>
      pendingProjectState.projectId === projectId
        ? pendingProjectState.updates
        : {},
    [pendingProjectState, projectId]
  );
  const hasPendingProjectChanges =
    Object.keys(pendingProjectUpdates).length > 0;

  const displayProject = useMemo<ProjectData>(
    () => ({ ...sourceProject, ...pendingProjectUpdates }),
    [sourceProject, pendingProjectUpdates]
  );

  const flushProjectUpdates = useCallback(() => {
    setPendingProjectState((current) => {
      if (
        current.projectId !== projectId ||
        Object.keys(current.updates).length === 0
      ) {
        return current;
      }
      onProjectUpdate(current.updates);
      return { projectId, updates: {} };
    });
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
      updateTimerRef.current = null;
    }
  }, [onProjectUpdate, projectId]);

  const handleLocalProjectUpdate = useCallback(
    (updates: Partial<ProjectData>) => {
      setPendingProjectState((prev) => ({
        projectId,
        updates: {
          ...(prev.projectId === projectId ? prev.updates : {}),
          ...updates,
        },
      }));
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
      updateTimerRef.current = setTimeout(
        flushProjectUpdates,
        STORY_UPDATE_DEBOUNCE_MS
      );
    },
    [flushProjectUpdates, projectId]
  );

  const onSetUnsavedRef = useRef(onSetUnsaved);
  useEffect(() => {
    onSetUnsavedRef.current = onSetUnsaved;
  }, [onSetUnsaved]);

  const hasAnyUnsavedChanges =
    hasPendingProjectChanges || hasWorkItemPendingChanges;
  useEffect(() => {
    onSetUnsavedRef.current?.(hasAnyUnsavedChanges);
  }, [hasAnyUnsavedChanges]);

  const flushProjectUpdatesRef = useRef(flushProjectUpdates);
  useEffect(() => {
    flushProjectUpdatesRef.current = flushProjectUpdates;
  }, [flushProjectUpdates]);

  useEffect(() => {
    return () => {
      flushProjectUpdatesRef.current();
    };
  }, []);

  const handleUpdateProjectMembers = useCallback(
    (members: Person[]) => {
      handleLocalProjectUpdate({ members });
    },
    [handleLocalProjectUpdate]
  );

  const handleProjectNameChange = useCallback(
    (name: string) => {
      handleLocalProjectUpdate({ name });
      onProjectNameUpdated?.(name);
    },
    [handleLocalProjectUpdate, onProjectNameUpdated]
  );

  const handleProjectDescriptionChange = useCallback(
    (_html: string, text: string) => {
      handleLocalProjectUpdate({ description: text });
    },
    [handleLocalProjectUpdate]
  );

  const handleWorkItemPrefixUpdate = useCallback(
    (prefix: string, custom: boolean) => {
      handleLocalProjectUpdate({
        workItemPrefix: prefix,
        workItemPrefixCustom: custom,
      });
    },
    [handleLocalProjectUpdate]
  );

  return {
    displayProject,
    hasPendingProjectChanges,
    hasAnyUnsavedChanges,
    handleLocalProjectUpdate,
    handleUpdateProjectMembers,
    handleProjectNameChange,
    handleProjectDescriptionChange,
    handleWorkItemPrefixUpdate,
  };
}
