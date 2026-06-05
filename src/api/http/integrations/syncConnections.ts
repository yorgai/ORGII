import { invoke } from "@tauri-apps/api/core";

import type { OAuthFlowStart } from "@src/api/http/project/syncTypes";

export const STORY_SYNC_ADAPTER = {
  LINEAR: "linear",
} as const;

export const STORY_SYNC_AUTH_METHOD = {
  PAT: "pat",
  OAUTH: "oauth",
} as const;

export type ProjectSyncAdapterType =
  (typeof STORY_SYNC_ADAPTER)[keyof typeof STORY_SYNC_ADAPTER];
export type ProjectSyncAuthMethod =
  (typeof STORY_SYNC_AUTH_METHOD)[keyof typeof STORY_SYNC_AUTH_METHOD];

export interface SyncConnection {
  id: string;
  adapter_id: ProjectSyncAdapterType;
  label: string;
  auth_method: ProjectSyncAuthMethod;
  account_email?: string;
  created_at_unix: number;
}

export interface SyncConnectionOAuthStartResult {
  connection: SyncConnection;
  flow: OAuthFlowStart;
}

export const syncConnectionsApi = {
  list(): Promise<SyncConnection[]> {
    return invoke("sync_connection_list");
  },

  createPat(
    adapterId: ProjectSyncAdapterType,
    label: string,
    token: string,
    accountEmail?: string
  ): Promise<SyncConnection> {
    return invoke("sync_connection_create_pat", {
      adapterId,
      label,
      token,
      accountEmail,
    });
  },

  rename(connectionId: string, label: string): Promise<SyncConnection> {
    return invoke("sync_connection_rename", { connectionId, label });
  },

  delete(connectionId: string): Promise<void> {
    return invoke("sync_connection_delete", { connectionId });
  },

  oauthStart(
    adapterId: ProjectSyncAdapterType,
    label: string,
    accountEmail?: string
  ): Promise<SyncConnectionOAuthStartResult> {
    return invoke("sync_connection_oauth_start", {
      adapterId,
      label,
      accountEmail,
    });
  },

  oauthComplete(connectionId: string): Promise<void> {
    return invoke("sync_connection_oauth_complete", { connectionId });
  },

  oauthCancel(connectionId: string): Promise<void> {
    return invoke("sync_connection_oauth_cancel", { connectionId });
  },
};

export default syncConnectionsApi;
