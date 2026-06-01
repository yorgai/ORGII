import { invoke } from "@tauri-apps/api/core";

import { asError } from "../result";
import type { Err, Json, Result } from "../types";

export function createPolicyHelpers() {
  const listPolicies = async (
    workspacePath?: string
  ): Promise<Result<{ policies: Json[] }>> => {
    try {
      const policies = (await invoke("policies_list", {
        workspacePath: workspacePath ?? null,
      })) as Json[];
      return { ok: true, policies };
    } catch (err) {
      return asError(err);
    }
  };

  const createPolicy = async (opts: Json): Promise<{ ok: true } | Err> => {
    try {
      await invoke("policies_create", opts);
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const readPolicy = async (
    name: string,
    source: string,
    workspacePath?: string
  ): Promise<Result<{ content: string }>> => {
    try {
      const content = (await invoke("policies_read", {
        name,
        source,
        workspacePath: workspacePath ?? null,
      })) as string;
      return { ok: true, content };
    } catch (err) {
      return asError(err);
    }
  };

  const updatePolicy = async (
    name: string,
    content: string,
    source: string,
    workspacePath?: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("policies_update", {
        name,
        content,
        source,
        workspacePath: workspacePath ?? null,
      });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const setPolicyAgents = async (
    name: string,
    source: string,
    agents: string[],
    workspacePath?: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("policies_set_agents", {
        name,
        source,
        agents,
        workspacePath: workspacePath ?? null,
      });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const setPolicyScope = async (
    name: string,
    source: string,
    scopeRepoPaths: string[] | null,
    scopeExcludeRepoPaths: string[] | null,
    workspacePath?: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("policies_set_scope", {
        name,
        source,
        scopeRepoPaths,
        scopeExcludeRepoPaths,
        workspacePath: workspacePath ?? null,
      });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const togglePolicy = async (
    name: string,
    source: string,
    enabled: boolean,
    workspacePath?: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("policies_toggle", {
        name,
        source,
        enabled,
        workspacePath: workspacePath ?? null,
      });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  const deletePolicy = async (
    name: string,
    source: string,
    workspacePath?: string
  ): Promise<{ ok: true } | Err> => {
    try {
      await invoke("policies_delete", {
        name,
        source,
        workspacePath: workspacePath ?? null,
      });
      return { ok: true };
    } catch (err) {
      return asError(err);
    }
  };

  return {
    listPolicies,
    createPolicy,
    readPolicy,
    updatePolicy,
    setPolicyAgents,
    setPolicyScope,
    togglePolicy,
    deletePolicy,
  };
}
