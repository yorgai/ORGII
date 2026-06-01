/**
 * Business logic hook for the Skill Editor.
 *
 * Handles: draft management, validation, token estimation,
 * save (create/update), and frontmatter generation.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useMemo, useState } from "react";

import { useMounted } from "@src/hooks/lifecycle/useMounted";
import {
  type BundledFileDraft,
  SKILL_SCOPE,
  type SkillEditorDraft,
  clearSkillEditorDraftAtom,
  createEmptySkillDraft,
  setSkillEditorDraftAtom,
  skillEditorDraftAtom,
} from "@src/modules/MainApp/Integrations/store/skills/skillEditorDraftAtom";
import type { InstalledSkill } from "@src/types/extensions";
import {
  DESCRIPTION_QUALITY,
  type DescriptionQuality,
  SKILL_SOURCE,
} from "@src/types/extensions/types";

function assessDescriptionQuality(description: string): DescriptionQuality {
  if (!description.trim()) return DESCRIPTION_QUALITY.MISSING;
  if (description.trim().length < 20) return DESCRIPTION_QUALITY.SHORT;
  return DESCRIPTION_QUALITY.GOOD;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildFrontmatter(draft: SkillEditorDraft): string {
  const lines: string[] = [];
  lines.push(`name: ${draft.name}`);
  if (draft.description.trim())
    lines.push(`description: ${draft.description.trim()}`);
  if (draft.alwaysActive) lines.push("always: true");
  if (draft.version.trim()) lines.push(`version: "${draft.version.trim()}"`);
  if (draft.license.trim()) lines.push(`license: ${draft.license.trim()}`);
  if (draft.compatibility.trim())
    lines.push(`compatibility: ${draft.compatibility.trim()}`);
  const bins = draft.requiredBins.map((b) => b.trim()).filter(Boolean);
  if (bins.length > 0) {
    lines.push("bins:");
    for (const bin of bins) {
      lines.push(`  - ${bin}`);
    }
  }
  const envNames = draft.requiredEnv.map((e) => e.trim()).filter(Boolean);
  if (envNames.length > 0) {
    lines.push("env:");
    for (const env of envNames) {
      lines.push(`  - ${env}`);
    }
  }
  return lines.join("\n");
}

interface ParsedFrontmatter {
  alwaysActive: boolean;
  version: string;
  description: string;
  license: string;
  compatibility: string;
  requiredBins: string[];
  requiredEnv: string[];
  body: string;
}

function parseFrontmatterFields(content: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = {
    alwaysActive: false,
    version: "",
    description: "",
    license: "",
    compatibility: "",
    requiredBins: [],
    requiredEnv: [],
    body: content,
  };

  if (!content.startsWith("---")) return result;

  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return result;

  const frontmatter = content.slice(3, endIdx);
  result.body = content.slice(endIdx + 3).replace(/^\n+/, "");

  let inBins = false;
  let inEnv = false;

  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("-") && trimmed.length > 0) {
      inBins = false;
      inEnv = false;
    }

    if (trimmed.startsWith("always:")) {
      result.alwaysActive = trimmed.includes("true");
    } else if (trimmed.startsWith("version:")) {
      result.version = trimmed
        .slice(8)
        .trim()
        .replace(/^["']|["']$/g, "");
    } else if (trimmed.startsWith("description:")) {
      result.description = trimmed
        .slice(12)
        .trim()
        .replace(/^["']|["']$/g, "");
    } else if (trimmed.startsWith("license:")) {
      result.license = trimmed
        .slice(8)
        .trim()
        .replace(/^["']|["']$/g, "");
    } else if (trimmed.startsWith("compatibility:")) {
      result.compatibility = trimmed
        .slice(14)
        .trim()
        .replace(/^["']|["']$/g, "");
    } else if (trimmed === "bins:" || trimmed.startsWith("bins:")) {
      inBins = true;
      inEnv = false;
    } else if (trimmed === "env:" || trimmed.startsWith("env:")) {
      inEnv = true;
      inBins = false;
    } else if (trimmed.startsWith("- ")) {
      const val = trimmed
        .slice(2)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (inBins && val) result.requiredBins.push(val);
      else if (inEnv && val) result.requiredEnv.push(val);
    }
  }

  return result;
}

export interface UseSkillEditorOptions {
  workspacePath?: string | null;
}

export interface UseSkillEditorReturn {
  draft: SkillEditorDraft | null;
  isEditing: boolean;
  descriptionQuality: DescriptionQuality;
  estimatedTokenCount: number;
  saving: boolean;
  saveError: string | null;
  validationError: string | null;
  updateDraft: (updates: Partial<SkillEditorDraft>) => void;
  startCreate: () => void;
  startEdit: (skill: InstalledSkill, content: string) => Promise<void>;
  save: () => Promise<boolean>;
  discard: () => void;
  validateName: (name: string) => Promise<string | null>;
}

export function useSkillEditor(
  options: UseSkillEditorOptions = {}
): UseSkillEditorReturn {
  const draft = useAtomValue(skillEditorDraftAtom);
  const setDraft = useSetAtom(setSkillEditorDraftAtom);
  const clearDraft = useSetAtom(clearSkillEditorDraftAtom);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const mountedRef = useMounted();

  const isEditing =
    draft?.editingSkillPath !== null && draft?.editingSkillPath !== undefined;

  const descriptionQuality = useMemo(
    () => assessDescriptionQuality(draft?.description ?? ""),
    [draft?.description]
  );

  const estimatedTokenCount = useMemo(() => {
    if (!draft) return 0;
    const fm = buildFrontmatter(draft);
    const fullContent = fm ? `---\n${fm}\n---\n\n${draft.body}` : draft.body;
    return estimateTokens(fullContent);
  }, [draft]);

  const updateDraft = useCallback(
    (updates: Partial<SkillEditorDraft>) => {
      if (!draft) return;
      setDraft({ ...draft, ...updates });
    },
    [draft, setDraft]
  );

  const startCreate = useCallback(() => {
    if (!draft) {
      setDraft(createEmptySkillDraft());
    }
  }, [draft, setDraft]);

  const startEdit = useCallback(
    async (skill: InstalledSkill, content: string) => {
      const parsed = parseFrontmatterFields(content);
      const workspacePath =
        skill.source === SKILL_SOURCE.WORKSPACE
          ? (options.workspacePath ?? null)
          : null;

      let bundledFileDrafts: BundledFileDraft[] = [];
      if (skill.bundledFiles.length > 0) {
        const results = await invoke<
          Array<{ relativePath: string; content: string; error: string | null }>
        >("skills_read_files_batch", {
          skillName: skill.name,
          relativePaths: skill.bundledFiles,
          workspacePath,
        });
        bundledFileDrafts = results.map((r) => ({
          relativePath: r.relativePath,
          content: r.error ? "" : r.content,
        }));
      }

      const onDiskScope =
        skill.source === SKILL_SOURCE.WORKSPACE
          ? SKILL_SCOPE.WORKSPACE
          : SKILL_SCOPE.GLOBAL;

      setDraft({
        name: skill.name,
        description: parsed.description || skill.description,
        alwaysActive: parsed.alwaysActive,
        version: parsed.version,
        license: parsed.license,
        compatibility: parsed.compatibility,
        requiredBins: parsed.requiredBins,
        requiredEnv: parsed.requiredEnv,
        scope: onDiskScope,
        originalScope: onDiskScope,
        body: parsed.body,
        editingSkillPath: skill.path,
        editingSkillName: skill.name,
        bundledFileDrafts,
      });
    },
    [setDraft, options.workspacePath]
  );

  const validateName = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        await invoke("skills_validate_name", { name, workspacePath: null });
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    []
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!draft) return false;

    setSaving(true);
    setSaveError(null);
    setValidationError(null);

    try {
      if (!draft.name.trim()) {
        setValidationError("Skill name is required");
        return false;
      }

      const frontmatter = buildFrontmatter(draft);
      const workspacePath =
        draft.scope === SKILL_SCOPE.WORKSPACE
          ? (options.workspacePath ?? null)
          : null;

      if (isEditing && draft.editingSkillPath) {
        let writePath = draft.editingSkillPath;

        if (draft.originalScope && draft.originalScope !== draft.scope) {
          if (draft.scope === SKILL_SCOPE.WORKSPACE && !options.workspacePath) {
            setValidationError(
              "Cannot move skill to workspace scope: no workspace is open."
            );
            return false;
          }
          const movedPath = await invoke<string>("skills_move", {
            skillPath: draft.editingSkillPath,
            targetScope: draft.scope,
            workspacePath:
              draft.scope === SKILL_SCOPE.WORKSPACE
                ? (options.workspacePath ?? null)
                : null,
          });
          writePath = movedPath;
        }

        await invoke("skills_update", {
          skillPath: writePath,
          frontmatter,
          body: draft.body,
        });
      } else {
        const nameError = await validateName(draft.name);
        if (nameError) {
          setValidationError(nameError);
          return false;
        }

        await invoke("skills_create", {
          name: draft.name,
          frontmatter,
          body: draft.body,
          workspacePath,
        });
      }

      const filesToWrite = draft.bundledFileDrafts.filter((file) =>
        file.relativePath.trim()
      );
      if (filesToWrite.length > 0) {
        const writeResults = await invoke<
          Array<{
            relativePath: string;
            success: boolean;
            error: string | null;
          }>
        >("skills_write_files_batch", {
          skillName: draft.name,
          files: filesToWrite.map((file) => ({
            relativePath: file.relativePath,
            content: file.content,
          })),
          workspacePath,
        });
        const failed = writeResults.filter((result) => !result.success);
        if (failed.length > 0) {
          const summary = failed
            .map(
              (result) =>
                `${result.relativePath}: ${result.error ?? "unknown error"}`
            )
            .join("; ");
          throw new Error(
            `Failed to write ${failed.length} bundled file(s): ${summary}`
          );
        }
      }

      if (mountedRef.current) {
        clearDraft();
      }
      return true;
    } catch (err) {
      if (mountedRef.current) {
        setSaveError(err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }, [
    draft,
    isEditing,
    validateName,
    clearDraft,
    options.workspacePath,
    mountedRef,
  ]);

  const discard = useCallback(() => {
    clearDraft();
    setSaveError(null);
    setValidationError(null);
  }, [clearDraft]);

  return {
    draft,
    isEditing,
    descriptionQuality,
    estimatedTokenCount,
    saving,
    saveError,
    validationError,
    updateDraft,
    startCreate,
    startEdit,
    save,
    discard,
    validateName,
  };
}
