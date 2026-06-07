import {
  STORY_SYNC_ADAPTER,
  type SyncConnection,
} from "@src/api/http/integrations";

export function getLinearOrgId(connectionId: string, teamId: string): string {
  return `linear:${connectionId}:${teamId}`;
}

export function getLinearTeamOrgName(teamName: string): string {
  return `Linear / ${teamName}`;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isLinearConnection(connection: SyncConnection): boolean {
  return connection.adapter_id === STORY_SYNC_ADAPTER.LINEAR;
}
