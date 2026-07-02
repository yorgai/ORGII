/**
 * ProjectSyncChannel — project / work-item collab sync (design §16.8).
 *
 * Runs inside the CollabSyncEngine's per-org pull cycle and bridges the
 * Rust-side orgii_collab outbox to the typed Supabase RPCs:
 *
 * - **Pull**: the `listOrgState` delta's typed project / work-item rows
 *   (version / updatedByMemberId / deletedAt since M1) are handed to
 *   `project_collab_apply_remote`, which soft-deletes tombstones and
 *   per-field-merges live rows via the FieldRevision resolver. The old
 *   jsonb mirror atoms are retired — shared entities are native local
 *   rows (§16.2) and the UI reads them through projectApi.
 * - **Push**: drain the org's outbox (whole-row snapshots + OCC base
 *   versions from the Rust bookkeeping) → upsert/delete RPCs → ack. An
 *   ORGII_CONFLICT pushes the fresh remote row through apply_remote
 *   (field merge happens Rust-side), acks the entry as conflicted
 *   (immediate requeue), and retries ONCE within the same cycle with
 *   the re-hydrated snapshot + new base version. A second conflict
 *   waits for the next cycle.
 *
 * No echo by construction: apply_remote never enqueues outbox rows, and
 * a client's own push comes back around the pull loop with a version
 * that is already recorded, so apply skips it.
 */
import type {
  CollabEntityKind,
  CollabOutboxAckResult,
  CollabOutboxPushItem,
  CollabRemoteEntity,
} from "@src/api/http/project";
import { COLLAB_ENTITY_KIND, COLLAB_PUSH_OP } from "@src/api/http/project";
import type { CollabOrgRecord } from "@src/store/collaboration/types";

import type { SupabaseSyncProfile } from "../collabSyncUtils";
import type {
  CollabOrgState,
  CollabSyncBackendClient,
} from "../sync/CollabSyncBackend";
import { isCollabConflictError } from "./collabSyncEngineHelpers";
import type { ProjectSyncBridge } from "./projectSyncBridge";

const DRAIN_BATCH_SIZE = 50;
/** One in-cycle retry after an OCC conflict (design §16.4). */
const MAX_PUSH_ROUNDS = 2;

type ProjectSyncClient = Pick<
  CollabSyncBackendClient,
  | "upsertProjectMetadata"
  | "upsertWorkItem"
  | "deleteProjectMetadata"
  | "deleteWorkItemMetadata"
  | "listOrgState"
>;

export interface ProjectSyncChannelDeps {
  client: ProjectSyncClient;
  bridge: ProjectSyncBridge;
}

export interface ProjectSyncCycleInput {
  org: CollabOrgRecord;
  profile: SupabaseSyncProfile;
  /** The delta already pulled by the engine's cycle (same cursor). */
  state: CollabOrgState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowId(row: Record<string, unknown>): string | null {
  return typeof row.id === "string" && row.id ? row.id : null;
}

function toRemoteEntity(
  kind: CollabEntityKind,
  row: Record<string, unknown>
): CollabRemoteEntity | null {
  if (!rowId(row)) return null;
  return {
    kind,
    payload: row,
    version: typeof row.version === "number" ? row.version : 0,
    updatedBy:
      typeof row.updatedByMemberId === "string" ? row.updatedByMemberId : null,
    deletedAt: typeof row.deletedAt === "string" ? row.deletedAt : null,
  };
}

export class ProjectSyncChannel {
  constructor(private readonly deps: ProjectSyncChannelDeps) {}

  /** The local project org aliased to this collab org (§16.2 keying). */
  static projectOrgId(org: CollabOrgRecord): string {
    return org.projectOrgId ?? org.id;
  }

  /** One org cycle: apply the pulled delta, then drain → push → ack. */
  async sync(input: ProjectSyncCycleInput): Promise<void> {
    await this.applyPulledState(input);
    await this.pushOutbox(input);
  }

  private async applyPulledState(input: ProjectSyncCycleInput): Promise<void> {
    const entities = [
      ...input.state.projects
        .filter(isRecord)
        .map((row) => toRemoteEntity(COLLAB_ENTITY_KIND.PROJECT, row)),
      ...input.state.workItems
        .filter(isRecord)
        .map((row) => toRemoteEntity(COLLAB_ENTITY_KIND.WORK_ITEM, row)),
    ].filter((entity): entity is CollabRemoteEntity => entity !== null);
    if (entities.length === 0) return;

    const applied = await this.deps.bridge.applyRemote({
      orgId: ProjectSyncChannel.projectOrgId(input.org),
      orgName: input.org.name,
      entities,
    });
    if (applied > 0) {
      await this.deps.bridge.notifyDataChanged();
    }
  }

  private async pushOutbox(input: ProjectSyncCycleInput): Promise<void> {
    const projectOrgId = ProjectSyncChannel.projectOrgId(input.org);
    for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
      const items = await this.deps.bridge.drainOutbox({
        orgId: projectOrgId,
        max: DRAIN_BATCH_SIZE,
      });
      if (items.length === 0) return;

      const acks: CollabOutboxAckResult[] = [];
      for (const item of items) {
        acks.push(await this.pushOne(input, projectOrgId, item));
      }
      const hadConflict = acks.some(
        (ack) => !ack.ok && ack.error === "ORGII_CONFLICT"
      );
      await this.deps.bridge.ackOutbox(acks);
      if (!hadConflict) return;
      // Conflicted entries were requeued by the ack and their entities
      // were re-based via apply_remote — the next round re-drains them
      // with a fresh snapshot + fresh base version.
    }
  }

  private async pushOne(
    input: ProjectSyncCycleInput,
    projectOrgId: string,
    item: CollabOutboxPushItem
  ): Promise<CollabOutboxAckResult> {
    const ackBase = {
      entryIds: item.entryIds,
      kind: item.kind,
      entityId: item.entityId,
    };
    try {
      if (item.op === COLLAB_PUSH_OP.DELETE) {
        if (item.kind === COLLAB_ENTITY_KIND.PROJECT) {
          await this.deps.client.deleteProjectMetadata({
            ...input.profile,
            orgId: input.org.id,
            projectId: item.entityId,
          });
        } else {
          await this.deps.client.deleteWorkItemMetadata({
            ...input.profile,
            orgId: input.org.id,
            workItemId: item.entityId,
          });
        }
        return { ...ackBase, ok: true };
      }

      const payload = item.payload ?? {};
      const result =
        item.kind === COLLAB_ENTITY_KIND.PROJECT
          ? await this.deps.client.upsertProjectMetadata({
              ...input.profile,
              orgId: input.org.id,
              project: payload,
              baseVersion: item.baseVersion ?? null,
            })
          : await this.deps.client.upsertWorkItem({
              ...input.profile,
              orgId: input.org.id,
              workItem: payload,
              baseVersion: item.baseVersion ?? null,
            });
      return { ...ackBase, ok: true, remoteVersion: result.version };
    } catch (error) {
      if (isCollabConflictError(error)) {
        // OCC rejection: pull the CURRENT remote row and let the Rust
        // side merge it per-field into the local row; the requeued
        // entry re-hydrates from the merged state on the retry round.
        await this.applyFreshRemoteRow(input, projectOrgId, item);
        return { ...ackBase, ok: false, error: "ORGII_CONFLICT" };
      }
      return {
        ...ackBase,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async applyFreshRemoteRow(
    input: ProjectSyncCycleInput,
    projectOrgId: string,
    item: CollabOutboxPushItem
  ): Promise<void> {
    // Full-state fetch (no cursor): the row that beat us may predate the
    // engine's delta cursor. Conflicts are rare enough that the extra
    // round-trip is acceptable.
    const state = await this.deps.client.listOrgState({
      ...input.profile,
      orgId: input.org.id,
    });
    const rows =
      item.kind === COLLAB_ENTITY_KIND.PROJECT
        ? state.projects
        : state.workItems;
    const row = rows
      .filter(isRecord)
      .find((candidate) => rowId(candidate) === item.entityId);
    if (!row) return;
    const entity = toRemoteEntity(item.kind, row);
    if (!entity) return;
    const applied = await this.deps.bridge.applyRemote({
      orgId: projectOrgId,
      orgName: input.org.name,
      entities: [entity],
    });
    if (applied > 0) {
      await this.deps.bridge.notifyDataChanged();
    }
  }
}
