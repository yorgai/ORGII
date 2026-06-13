import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type EmbeddingModelStatus,
  type USearchIndexInfo,
  checkAdvancedSearchEnabled,
  checkEmbeddingModelStatus,
  deleteEmbeddingModel,
  downloadEmbeddingModel,
  getModelDirPath,
  getSemanticIndexInfo,
  indexRepositorySemantic,
  removeRepositorySemantic,
} from "@src/api/tauri/search";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import {
  SECTION_ACTION_GAP_CLASSES,
  SECTION_GAP_CLASSES,
  SECTION_PATH_TEXT_CLASSES,
  SECTION_VALUE_SMALL_MUTED_CLASSES,
  SECTION_VALUE_TEXT_SUCCESS_CLASSES,
  SECTION_VALUE_TEXT_WARNING_CLASSES,
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  type Repo,
  currentRepoAtom,
  reposAtom,
  selectedRepoIdAtom,
} from "@src/store/repo";

function normalizeRepoPath(repo: Repo | null | undefined): string | null {
  const rawPath = repo?.path ?? repo?.fs_uri;
  if (!rawPath) {
    return null;
  }

  const withoutScheme = rawPath.startsWith("file://")
    ? rawPath.replace("file://", "")
    : rawPath;
  return decodeURIComponent(withoutScheme);
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return "0 MB";
  }

  const units = ["B", "KB", "MB", "GB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

const AdvancedSearchUnavailable: React.FC = () => {
  const { t } = useTranslation("settings");

  return (
    <SectionContainer>
      <SectionRow
        label={t("indexing.advancedSearchBuild")}
        description={t("indexing.advancedSearchUnavailableDesc")}
      >
        <span className={SECTION_VALUE_TEXT_WARNING_CLASSES}>
          {t("indexing.advancedSearchNotEnabled")}
        </span>
      </SectionRow>
      <SectionRow
        label={t("indexing.defaultSearchAvailable")}
        description={t("indexing.defaultSearchAvailableDesc")}
      >
        <span className={SECTION_VALUE_SMALL_MUTED_CLASSES}>
          {t("indexing.regexAndSymbols")}
        </span>
      </SectionRow>
      <SectionRow
        label={t("indexing.semanticBuildCommand")}
        description={t("indexing.semanticBuildCommandDesc")}
      >
        <span className={SECTION_VALUE_SMALL_MUTED_CLASSES}>
          npm run tauri:dev:semantic
        </span>
      </SectionRow>
    </SectionContainer>
  );
};

const AdvancedIndexingControls: React.FC = () => {
  const { t } = useTranslation("settings");
  const currentRepo = useAtomValue(currentRepoAtom);
  const repos = useAtomValue(reposAtom);
  const selectedRepoId = useAtomValue(selectedRepoIdAtom);
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [semanticInfo, setSemanticInfo] = useState<USearchIndexInfo | null>(
    null
  );
  const [modelStatus, setModelStatus] = useState<EmbeddingModelStatus | null>(
    null
  );
  const [modelDir, setModelDir] = useState<string>("");

  const selectedRepoPath = useMemo(
    () => normalizeRepoPath(currentRepo),
    [currentRepo]
  );

  const refresh = useCallback(async () => {
    const [nextSemanticInfo, nextModelStatus, nextModelDir] = await Promise.all(
      [getSemanticIndexInfo(), checkEmbeddingModelStatus(), getModelDirPath()]
    );
    setSemanticInfo(nextSemanticInfo);
    setModelStatus(nextModelStatus);
    setModelDir(nextModelDir);
  }, []);

  useEffect(() => {
    let cancelled = false;

    refresh().catch((error: unknown) => {
      if (!cancelled) {
        Message.error(String(error));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const runRepoOperation = useCallback(
    async (
      operation: (repoId: string, repoPath: string) => Promise<unknown>
    ) => {
      if (!selectedRepoId || !selectedRepoPath) {
        Message.warning(t("indexing.repoPathNotAvailable"));
        return;
      }

      setLoading(true);
      try {
        await operation(selectedRepoId, selectedRepoPath);
        await refresh();
      } catch (error: unknown) {
        Message.error(String(error));
      } finally {
        setLoading(false);
      }
    },
    [refresh, selectedRepoId, selectedRepoPath, t]
  );

  const handleDownloadModel = useCallback(async () => {
    setModelLoading(true);
    try {
      await downloadEmbeddingModel();
      await refresh();
      Message.success(t("indexing.modelReady"));
    } catch (error: unknown) {
      Message.error(String(error));
    } finally {
      setModelLoading(false);
    }
  }, [refresh, t]);

  const handleDeleteModel = useCallback(async () => {
    setModelLoading(true);
    try {
      await deleteEmbeddingModel();
      await refresh();
      Message.success(t("indexing.modelDeleted"));
    } catch (error: unknown) {
      Message.error(String(error));
    } finally {
      setModelLoading(false);
    }
  }, [refresh, t]);

  return (
    <>
      <SectionContainer title={t("indexing.advancedSearchBuild")}>
        <SectionRow
          label={t("indexing.defaultSearchAvailable")}
          description={t("indexing.defaultSearchAvailableDesc")}
        >
          <span className={SECTION_VALUE_TEXT_SUCCESS_CLASSES}>
            {t("indexing.regexAndSymbols")}
          </span>
        </SectionRow>
        <SectionRow
          label={t("indexing.embeddingStatus")}
          description={t("indexing.embeddingModelDesc")}
        >
          <span
            className={
              modelStatus?.installed
                ? SECTION_VALUE_TEXT_SUCCESS_CLASSES
                : SECTION_VALUE_TEXT_WARNING_CLASSES
            }
          >
            {modelStatus?.installed
              ? t("indexing.modelReady")
              : t("indexing.modelNotInstalled")}
          </span>
        </SectionRow>
        <SectionRow
          label={t("indexing.modelDirectory")}
          description={t("indexing.modelDirectoryDesc")}
        >
          <span className={SECTION_PATH_TEXT_CLASSES}>{modelDir || "—"}</span>
        </SectionRow>
        <SectionRow
          label={t("indexing.downloadModel")}
          description={formatBytes(modelStatus?.model_size_bytes)}
        >
          <div className={SECTION_ACTION_GAP_CLASSES}>
            <Button
              onClick={handleDownloadModel}
              loading={modelLoading}
              disabled={modelLoading}
            >
              {modelStatus?.installed
                ? t("indexing.downloadRetry")
                : t("indexing.downloadModel")}
            </Button>
            {modelStatus?.installed && (
              <Button
                onClick={handleDeleteModel}
                loading={modelLoading}
                disabled={modelLoading}
              >
                {t("indexing.deleteModel")}
              </Button>
            )}
          </div>
        </SectionRow>
      </SectionContainer>

      <SectionContainer title={t("indexing.indexStorageSection")}>
        <SectionRow
          label={t("indexing.embeddingIndex")}
          description={t("indexing.chunksEmbedded", {
            count: semanticInfo?.vector_count ?? 0,
          })}
        >
          <span className={SECTION_VALUE_SMALL_MUTED_CLASSES}>
            {formatBytes(semanticInfo?.index_size_bytes)}
          </span>
        </SectionRow>
      </SectionContainer>

      <SectionContainer title={t("indexing.currentRepo")}>
        <SectionRow
          label={currentRepo?.name ?? t("indexing.noRepoSelected")}
          description={selectedRepoPath ?? t("indexing.repoPathNotAvailable")}
        >
          <div className={SECTION_ACTION_GAP_CLASSES}>
            <Button
              onClick={() => runRepoOperation(indexRepositorySemantic)}
              loading={loading}
              disabled={loading || !selectedRepoPath || !modelStatus?.installed}
            >
              {t("indexing.embed")}
            </Button>
            <Button
              onClick={() =>
                runRepoOperation(async (repoId) =>
                  removeRepositorySemantic(repoId)
                )
              }
              loading={loading}
              disabled={loading || !selectedRepoId}
            >
              {t("indexing.deleteEmbedding")}
            </Button>
          </div>
        </SectionRow>
        <SectionRow
          label={t("indexing.repos")}
          description={t("indexing.noRepositories")}
        >
          <span className={SECTION_VALUE_SMALL_MUTED_CLASSES}>
            {repos.length.toLocaleString()}
          </span>
        </SectionRow>
      </SectionContainer>
    </>
  );
};

const IndexingSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const [advancedSearchEnabled, setAdvancedSearchEnabled] = useState<
    boolean | null
  >(null);

  useEffect(() => {
    let cancelled = false;

    checkAdvancedSearchEnabled().then((enabled) => {
      if (!cancelled) {
        setAdvancedSearchEnabled(enabled);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={SECTION_GAP_CLASSES}>
      {advancedSearchEnabled === null ? (
        <SectionContainer title={t("indexing.advancedSearchBuild")}>
          <SectionRow
            label={t("indexing.checkingAdvancedSearch")}
            description={t("indexing.checkingAdvancedSearchDesc")}
          >
            <span className={SECTION_VALUE_SMALL_MUTED_CLASSES}>
              {t("common:status.loading")}
            </span>
          </SectionRow>
        </SectionContainer>
      ) : advancedSearchEnabled ? (
        <AdvancedIndexingControls />
      ) : (
        <AdvancedSearchUnavailable />
      )}
    </div>
  );
};

export default IndexingSection;
