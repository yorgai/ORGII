import { invoke } from "@tauri-apps/api/core";

import { asError } from "../result";
import type { Err, Json, Result } from "../types";

export function createExternalToolHelpers() {
  const importDetect = async (
    repoPath?: string | null
  ): Promise<Result<{ items: Json[] }>> => {
    try {
      const items = (await invoke("external_import_detect", {
        repoPath: repoPath ?? null,
      })) as Json[];
      return { ok: true, items };
    } catch (err) {
      return asError(err);
    }
  };

  const importApply = async (
    selections: Json[]
  ): Promise<Result<{ report: Json }>> => {
    try {
      const report = (await invoke("external_import_apply", {
        selections,
      })) as Json;
      return { ok: true, report };
    } catch (err) {
      return asError(err);
    }
  };

  const listSkills = async (
    workspacePath?: string | null,
    agentId?: string | null
  ): Promise<Result<{ skills: Json[] }>> => {
    try {
      const skills = (await invoke("skills_list", {
        workspacePath: workspacePath ?? null,
        agentId: agentId ?? null,
      })) as Json[];
      return { ok: true, skills };
    } catch (err) {
      return asError(err);
    }
  };

  const readSkill = async (
    name: string,
    workspacePath?: string | null
  ): Promise<Result<{ content: string }>> => {
    try {
      const content = (await invoke("skills_read", {
        workspacePath: workspacePath ?? null,
        name,
      })) as string;
      return { ok: true, content };
    } catch (err) {
      return asError(err);
    }
  };

  const createSkill = async (opts: {
    name: string;
    frontmatter: string;
    body: string;
    workspacePath?: string | null;
  }): Promise<Result<{ skill: Json }>> => {
    try {
      const skill = (await invoke("skills_create", {
        name: opts.name,
        frontmatter: opts.frontmatter,
        body: opts.body,
        workspacePath: opts.workspacePath ?? null,
      })) as Json;
      return { ok: true, skill };
    } catch (err) {
      return asError(err);
    }
  };

  const validateSkillName = async (
    name: string,
    workspacePath?: string | null
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("skills_validate_name", {
        name,
        workspacePath: workspacePath ?? null,
      });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const toggleSkill = async (
    name: string,
    enabled: boolean,
    agentId?: string | null,
    workspacePath?: string | null
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("skills_toggle", {
        workspacePath: workspacePath ?? null,
        agentId: agentId ?? null,
        name,
        enabled,
      });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const moveSkill = async (
    skillPath: string,
    targetScope: "global" | "workspace",
    workspacePath?: string | null
  ): Promise<Result<{ newPath: string }>> => {
    try {
      const newPath = (await invoke("skills_move", {
        skillPath,
        targetScope,
        workspacePath: workspacePath ?? null,
      })) as string;
      return { ok: true, newPath };
    } catch (err) {
      return asError(err);
    }
  };

  const readSkillFiles = async (
    skillName: string,
    relativePaths: string[],
    workspacePath?: string | null
  ): Promise<Result<{ files: Json[] }>> => {
    try {
      const files = (await invoke("skills_read_files_batch", {
        skillName,
        relativePaths,
        workspacePath: workspacePath ?? null,
      })) as Json[];
      return { ok: true, files };
    } catch (err) {
      return asError(err);
    }
  };

  const writeSkillFiles = async (
    skillName: string,
    files: Array<{ relativePath: string; content: string }>,
    workspacePath?: string | null
  ): Promise<Result<{ results: Json[] }>> => {
    try {
      const results = (await invoke("skills_write_files_batch", {
        skillName,
        files,
        workspacePath: workspacePath ?? null,
      })) as Json[];
      return { ok: true, results };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    importDetect,
    importApply,
    listSkills,
    readSkill,
    createSkill,
    validateSkillName,
    toggleSkill,
    moveSkill,
    readSkillFiles,
    writeSkillFiles,
  };
}
