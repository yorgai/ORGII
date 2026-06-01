/**
 * useWorkItemsState
 *
 * Manages all local state for the WorkItem page
 */
import { useRef, useState } from "react";

import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

import type { StatusFilterType, WorkItemsViewTab } from "../types";

export function useWorkItemsState(initialActiveTab: WorkItemsViewTab = "List") {
  const [activeTab, setActiveTab] =
    useState<WorkItemsViewTab>(initialActiveTab);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>("all");
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(
    null
  );
  const [showProperties, setShowProperties] = useState(false);

  // Track if properties panel was open before selecting a work item
  const propertiesWasOpenRef = useRef<boolean | null>(null);

  // Local state for optimistic updates (keyed by session_id)
  const [localUpdates, setLocalUpdates] = useState<
    Record<string, Partial<WorkItemExtended>>
  >({});

  return {
    // State values
    activeTab,
    searchQuery,
    statusFilter,
    selectedWorkItemId,
    showProperties,
    propertiesWasOpenRef,
    localUpdates,

    // State setters
    setActiveTab,
    setSearchQuery,
    setStatusFilter,
    setSelectedWorkItemId,
    setShowProperties,
    setLocalUpdates,
  };
}
