import { invoke } from "@tauri-apps/api/core";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { Eye, Search } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import type { HubSkillDetail, HubSkillResult } from "@src/types/extensions";
import { openFileInWorkStation } from "@src/util/ui/openFileInWorkStation";

interface FindSkillsSectionProps {
  onPreview?: (slug: string) => void;
}

function sanitizeSkillFileSegment(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-") || "skill";
}

async function previewRemoteSkill(result: HubSkillResult): Promise<void> {
  const detail = await invoke<HubSkillDetail>("skills_hub_detail", {
    slug: result.slug,
  });
  const skillMd = detail.skillMd?.trim();
  if (!skillMd) {
    throw new Error("No SKILL.md found in the skills.sh snapshot");
  }

  const baseDir = await appCacheDir();
  const skillDir = await join(
    baseDir,
    "skills-sh-preview",
    sanitizeSkillFileSegment(result.slug)
  );
  await mkdir(skillDir, { recursive: true });
  const filePath = await join(skillDir, "SKILL.md");
  await writeTextFile(filePath, skillMd);
  openFileInWorkStation(filePath, { defaultPreviewMode: true });
}

const FindSkillsSection: React.FC<FindSkillsSectionProps> = ({ onPreview }) => {
  const { t } = useTranslation("integrations");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HubSkillResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [previewingSlug, setPreviewingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSearch = query.trim().length >= 2 && !searching;

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    setSearching(true);
    setError(null);
    setHasSearched(true);
    try {
      const response = await invoke<HubSkillResult[]>("skills_hub_search", {
        query: trimmed,
        limit: 25,
      });
      setResults(response);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handlePreview = useCallback(
    async (result: HubSkillResult) => {
      if (previewingSlug !== null) return;
      setPreviewingSlug(result.slug);
      setError(null);
      try {
        await previewRemoteSkill(result);
        onPreview?.(result.slug);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPreviewingSlug(null);
      }
    },
    [onPreview, previewingSlug]
  );

  const columns = useMemo<SettingsTableColumn<HubSkillResult>[]>(
    () => [
      {
        key: "name",
        label: t("common:labels.name"),
        width: SETTINGS_TABLE_COL.fill,
        sorter: (rowA, rowB) => rowA.name.localeCompare(rowB.name),
        renderCell: (result) => (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={SETTINGS_TABLE_CELL.primary + " truncate"}>
              {result.name}
            </span>
            <span className={SETTINGS_TABLE_CELL.subtitle + " truncate"}>
              {result.slug}
            </span>
          </div>
        ),
      },
      {
        key: "source",
        label: t("common:labels.source"),
        width: SETTINGS_TABLE_COL.valueLg,
        sorter: (rowA, rowB) =>
          (rowA.source ?? "").localeCompare(rowB.source ?? ""),
        renderCell: (result) => (
          <span className={SETTINGS_TABLE_CELL.value}>
            {result.source || t("common:status.unknown")}
          </span>
        ),
      },
      {
        key: "installs",
        label: t("agentOrgs.findSkills.installs"),
        width: SETTINGS_TABLE_COL.valueLg,
        align: "right",
        sorter: (rowA, rowB) => (rowA.installs ?? 0) - (rowB.installs ?? 0),
        renderCell: (result) => (
          <span className={SETTINGS_TABLE_CELL.value}>
            {typeof result.installs === "number"
              ? result.installs.toLocaleString()
              : "—"}
          </span>
        ),
      },
      {
        key: "actions",
        label: "",
        width: SETTINGS_TABLE_COL.hug,
        align: "right",
        renderCell: (result) => (
          <div onClick={(event) => event.stopPropagation()}>
            <Button
              variant="secondary"
              size="small"
              icon={<Eye size={14} />}
              loading={previewingSlug === result.slug}
              disabled={
                previewingSlug !== null && previewingSlug !== result.slug
              }
              onClick={() => void handlePreview(result)}
            >
              {t("common:labels.preview")}
            </Button>
          </div>
        ),
      },
    ],
    [handlePreview, previewingSlug, t]
  );

  return (
    <SectionContainer>
      <SectionRow label={t("agentOrgs.findSkills.title")}>
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <Input
            type="search"
            size="small"
            className="min-w-0 flex-1 sm:w-72"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setError(null);
            }}
            placeholder={t("agentOrgs.findSkills.placeholder")}
            prefix={<Search size={14} className="text-text-3" aria-hidden />}
            allowClear
            onClear={() => {
              setQuery("");
              setResults([]);
              setHasSearched(false);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleSearch();
              }
            }}
          />
          <Button
            variant="primary"
            size="small"
            loading={searching}
            disabled={!canSearch}
            onClick={() => void handleSearch()}
          >
            {t("common:actions.search")}
          </Button>
        </div>
      </SectionRow>
      <SectionRow showHeader={false} className="pt-0">
        <div className="flex w-full min-w-0 flex-col gap-2">
          {error && <span className="text-[12px] text-danger-6">{error}</span>}
          <SettingsTable<HubSkillResult>
            hover
            loading={searching}
            columns={columns}
            rows={results}
            getRowKey={(result) => result.slug}
            onRowClick={(result) => void handlePreview(result)}
            headerHeight="compact"
            emptyTitle={
              hasSearched
                ? t("agentOrgs.findSkills.noResults")
                : t("agentOrgs.findSkills.emptyTitle")
            }
            emptySubtitle={
              hasSearched
                ? t("agentOrgs.findSkills.noResultsDesc")
                : t("agentOrgs.findSkills.emptySubtitle")
            }
          />
        </div>
      </SectionRow>
    </SectionContainer>
  );
};

export default FindSkillsSection;
