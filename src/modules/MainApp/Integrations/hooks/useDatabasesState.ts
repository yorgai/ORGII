/**
 * useDatabasesState Hook
 *
 * Manages database integration state for the Integrations page.
 * Reads connection configs from store, provides selection, probe, toggle.
 *
 * "Add connection" wizard open-state is read from the URL via
 * {@link useWizardParam} (`?wizard=db-connection-add`).
 */
import { useCallback, useState } from "react";

import { WIZARD_IDS } from "@src/config/mainAppPaths";
import {
  type DatabaseConnectionConfig,
  DatabaseServiceFactory,
  getConnectionPath,
} from "@src/engines/DatabaseCore";
import { useWizardParam } from "@src/hooks/navigation";
import {
  loadConnectionConfigs,
  removeConnectionConfig,
} from "@src/store/workstation/database";

import type {
  DatabaseConnectionStatus,
  DatabaseIntegrationEntry,
  DatabaseProbeResult,
} from "../Databases/types";
import type { DetailMode, IntegrationCategory } from "../types";

export interface UseDatabasesStateReturn {
  databases: DatabaseIntegrationEntry[];
  selectedDatabase: DatabaseIntegrationEntry | null;
  probeResult: DatabaseProbeResult | null;
  probing: boolean;
  loading: boolean;
  handleSelectDatabase: (id: string | null, mode?: DetailMode) => void;
  handleProbe: () => void;
  handleRemove: () => void;
  handleAddDatabase: () => void;
  clearDatabasesState: () => void;
  addWizardOpen: boolean;
  closeAddWizard: () => void;
  refreshDatabases: () => Promise<void>;
}

function configToEntry(
  config: DatabaseConnectionConfig
): DatabaseIntegrationEntry {
  const service = DatabaseServiceFactory.get(config.id);
  let connectionStatus: DatabaseConnectionStatus = "unknown";
  let connectionError: string | undefined;

  if (service) {
    const status = service.status;
    if (status.state === "connected") connectionStatus = "connected";
    else if (status.state === "connecting") connectionStatus = "connecting";
    else if (status.state === "error") {
      connectionStatus = "error";
      connectionError = status.error;
    } else connectionStatus = "disabled";
  }

  return {
    id: config.id,
    name: config.name,
    type: config.type,
    connectionStatus,
    connectionError,
    url: getConnectionPath(config),
  };
}

export function useDatabasesState(
  activeCategory: IntegrationCategory,
  setDetailMode: (mode: DetailMode) => void
): UseDatabasesStateReturn {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<DatabaseProbeResult | null>(
    null
  );
  const [probing, setProbing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const { wizard, openWizard, closeWizard } = useWizardParam();
  const addWizardOpen = wizard === WIZARD_IDS.DB_CONNECTION_ADD;

  void refreshKey;
  const configs = activeCategory === "databases" ? loadConnectionConfigs() : [];
  const databases = configs.map(configToEntry);

  const selectedDatabase = databases.find((db) => db.id === selectedId) ?? null;

  const handleSelectDatabase = useCallback(
    (id: string | null, mode?: DetailMode) => {
      setSelectedId(id);
      setProbeResult(null);
      setDetailMode(mode ?? "preview");
    },
    [setDetailMode]
  );

  const handleProbe = useCallback(async () => {
    if (!selectedId) return;
    setProbing(true);
    setProbeResult(null);

    const startTime = performance.now();
    try {
      const configs = loadConnectionConfigs();
      const config = configs.find((cfg) => cfg.id === selectedId);
      if (!config) throw new Error("Config not found");

      const service = await DatabaseServiceFactory.create(config);
      await service.connect();
      const tables = await service.getTables();
      const elapsed_ms = Math.round(performance.now() - startTime);

      setProbeResult({ ok: true, tableCount: tables.length, elapsed_ms });
      setRefreshKey((prev) => prev + 1);
    } catch (err) {
      const elapsed_ms = Math.round(performance.now() - startTime);
      setProbeResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms,
      });
    } finally {
      setProbing(false);
    }
  }, [selectedId]);

  const handleRemove = useCallback(() => {
    if (!selectedId) return;
    DatabaseServiceFactory.remove(selectedId);
    removeConnectionConfig(selectedId);
    setSelectedId(null);
    setProbeResult(null);
    setDetailMode("preview");
    setRefreshKey((prev) => prev + 1);
  }, [selectedId, setDetailMode]);

  const handleAddDatabase = useCallback(() => {
    openWizard(WIZARD_IDS.DB_CONNECTION_ADD);
  }, [openWizard]);

  const closeAddWizard = useCallback(() => {
    closeWizard();
    setRefreshKey((prev) => prev + 1);
  }, [closeWizard]);

  const clearDatabasesState = useCallback(() => {
    setSelectedId(null);
    setProbeResult(null);
    closeWizard();
  }, [closeWizard]);

  const refreshDatabases = useCallback(async () => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const loading = false;

  return {
    databases,
    selectedDatabase,
    probeResult,
    probing,
    loading,
    handleSelectDatabase,
    handleProbe,
    handleRemove,
    handleAddDatabase,
    clearDatabasesState,
    addWizardOpen,
    closeAddWizard,
    refreshDatabases,
  };
}
