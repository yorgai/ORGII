import type { TFunction } from "i18next";
import React from "react";

import type { EnrichedWorkItem, ProjectData } from "@src/api/http/project";
import { SectionContainer } from "@src/modules/shared/layouts/SectionLayout";

interface MetadataSectionHeaderProps {
  title: string;
  description: string;
  countLabel: string;
}

function MetadataSectionHeader({
  title,
  description,
  countLabel,
}: MetadataSectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[13px] font-semibold text-text-1">{title}</div>
        <div className="mt-1 text-[12px] text-text-3">{description}</div>
      </div>
      <div className="rounded-full bg-fill-1 px-2 py-0.5 text-[11px] text-text-3">
        {countLabel}
      </div>
    </div>
  );
}

function MetadataError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded-lg bg-danger-1 px-3 py-2 text-[12px] text-danger-6">
      {error}
    </div>
  );
}

interface WorkItemsSectionProps {
  t: TFunction<"navigation">;
  workItems: EnrichedWorkItem[];
  localMetadataError: string | null;
}

// Typed native rows (design §16.2): shared work items live in the local
// project store, so the section renders EnrichedWorkItem directly — the
// defensive jsonb probing of the retired mirror atoms is gone.
export function WorkItemsSection({
  t,
  workItems,
  localMetadataError,
}: WorkItemsSectionProps) {
  return (
    <SectionContainer color="chatPanelInfo" padding="default">
      <div className="flex min-h-[320px] flex-col gap-3">
        <MetadataSectionHeader
          title={t("collaboration.workItems.title")}
          description={t("collaboration.workItems.description")}
          countLabel={t("collaboration.workItems.count", {
            count: workItems.length,
          })}
        />
        <MetadataError error={localMetadataError} />
        {workItems.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center rounded-lg bg-fill-1 px-4 text-center text-[13px] text-text-3">
            {t("collaboration.workItems.empty")}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border-2 rounded-xl border border-border-2 bg-bg-2">
            {workItems.map((workItem) => (
              <div key={workItem.id} className="flex flex-col gap-2 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-text-1">
                      {workItem.title || workItem.shortId}
                    </div>
                    <div className="mt-1 truncate text-[12px] text-text-3">
                      {workItem.project?.name ?? workItem.shortId}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full bg-fill-1 px-2 py-0.5 text-[11px] text-text-3">
                    {workItem.status}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px] text-text-3">
                  <span className="rounded-full bg-fill-1 px-2 py-0.5">
                    {workItem.priority}
                  </span>
                  <span className="rounded-full bg-fill-1 px-2 py-0.5">
                    {workItem.assignee?.name ??
                      t("collaboration.workItems.unassigned")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionContainer>
  );
}

interface ProjectsSectionProps {
  t: TFunction<"navigation">;
  projects: ProjectData[];
  localMetadataError: string | null;
}

export function ProjectsSection({
  t,
  projects,
  localMetadataError,
}: ProjectsSectionProps) {
  return (
    <SectionContainer color="chatPanelInfo" padding="default">
      <div className="flex min-h-[320px] flex-col gap-3">
        <MetadataSectionHeader
          title={t("collaboration.projects.title")}
          description={t("collaboration.projects.description")}
          countLabel={t("collaboration.projects.count", {
            count: projects.length,
          })}
        />
        <MetadataError error={localMetadataError} />
        {projects.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center rounded-lg bg-fill-1 px-4 text-center text-[13px] text-text-3">
            {t("collaboration.projects.empty")}
          </div>
        ) : (
          <div className="grid gap-3 @[720px]:grid-cols-2">
            {projects.map((project) => (
              <div
                key={project.meta.id}
                className="rounded-xl border border-border-2 bg-bg-2 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-text-1">
                      {project.meta.name}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[12px] text-text-3">
                      {project.description ||
                        t("collaboration.projects.noDescription")}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full bg-fill-1 px-2 py-0.5 text-[11px] text-text-3">
                    {project.meta.status}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-text-3">
                  <span className="rounded-full bg-fill-1 px-2 py-0.5">
                    {project.meta.priority}
                  </span>
                  <span className="rounded-full bg-fill-1 px-2 py-0.5">
                    {project.meta.health}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionContainer>
  );
}
