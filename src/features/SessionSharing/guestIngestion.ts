import { rpc } from "@src/api/tauri/rpc";
import type { RemoteSharedSessionRecord } from "@src/api/tauri/rpc/schemas/remoteSharedSession";
import type { DispatchCategory } from "@src/api/tauri/session";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  MIRROR_STATUS,
  SESSION_SHARE_PROTOCOL_VERSION,
  SHARE_MESSAGE_TYPE,
  type ShareBootstrapMessage,
  type ShareEventPatchMessage,
  type ShareEventRemoveMessage,
  type ShareEventUpsertMessage,
  type ShareEventsAppendMessage,
  type ShareMessage,
  type ShareSessionPatchMessage,
} from "./types";
import { type GuestShareHandle, createGuestShareHandle } from "./webrtc";

export interface GuestSessionShareConnection {
  localSessionId: string;
  shareId: string;
  sourceSessionId: string;
  answerCode: string;
  authenticated: Promise<void>;
  getRecord(): Promise<RemoteSharedSessionRecord | null>;
  sendViewerMessage(text: string, viewerLabel?: string): void;
  close(): Promise<void>;
}

interface GuestIngestionState {
  localSessionId: string;
  sourceSessionId: string;
  shareId: string;
  expectedSequence: number;
  bootstrapped: boolean;
}

function createLocalMirrorSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `sharedsession-${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

function toWireSourceCategory(
  category: DispatchCategory
): "cli" | "agent" | "os" | "remote_shared" {
  if (category === "cli_agent") return "cli";
  if (category === "remote_shared_session") return "remote_shared";
  return "agent";
}

function rewriteEventsForLocalMirror(
  events: SessionEvent[],
  localSessionId: string
): SessionEvent[] {
  return events.map((event) => ({ ...event, sessionId: localSessionId }));
}

function assertOrdered(
  state: GuestIngestionState,
  message: ShareMessage
): void {
  if (message.sequence !== state.expectedSequence) {
    throw new Error(
      `Share sequence gap: expected ${state.expectedSequence}, received ${message.sequence}`
    );
  }
  state.expectedSequence += 1;
}

async function applyBootstrap(
  state: GuestIngestionState,
  message: ShareBootstrapMessage
): Promise<void> {
  const localEvents = rewriteEventsForLocalMirror(
    message.payload.events,
    state.localSessionId
  );
  await rpc.remoteSharedSession.create({
    request: {
      sessionId: state.localSessionId,
      sourceSessionId: message.payload.source.sourceSessionId,
      shareId: message.payload.share.shareId,
      sourceCategory: toWireSourceCategory(
        message.payload.source.sourceCategory
      ),
      shareMode: message.payload.share.shareMode,
      name: message.payload.source.name,
      status: MIRROR_STATUS.LIVE,
      repoName: message.payload.source.repoName,
      repoPath: message.payload.source.repoPath,
      model: message.payload.source.model,
      cliAgentType: message.payload.source.cliAgentType,
      sourcePeerLabel: message.payload.share.hostPeerLabel,
      metadataJson: JSON.stringify(message.payload.source),
      totalTokens: message.payload.source.totalTokens,
    },
  });
  await eventStoreProxy.set(localEvents, state.localSessionId);
  state.bootstrapped = true;
}

async function applyEventsAppend(
  state: GuestIngestionState,
  message: ShareEventsAppendMessage
): Promise<void> {
  const events = rewriteEventsForLocalMirror(
    message.events,
    state.localSessionId
  );
  await eventStoreProxy.mergeEvents(events, state.localSessionId);
}

async function applyEventUpsert(
  state: GuestIngestionState,
  message: ShareEventUpsertMessage
): Promise<void> {
  const [event] = rewriteEventsForLocalMirror(
    [message.event],
    state.localSessionId
  );
  await eventStoreProxy.upsert(event, state.localSessionId);
}

async function applyEventPatch(
  state: GuestIngestionState,
  message: ShareEventPatchMessage
): Promise<void> {
  await eventStoreProxy.updateById(
    message.eventId,
    { ...message.patch, sessionId: state.localSessionId },
    state.localSessionId
  );
}

async function applyEventRemove(
  state: GuestIngestionState,
  message: ShareEventRemoveMessage
): Promise<void> {
  if (message.eventIdPrefix) {
    await eventStoreProxy.removeByIdPrefix(
      message.eventIdPrefix,
      state.localSessionId
    );
    return;
  }
  if (message.eventId) {
    await eventStoreProxy.patchByIds(
      [message.eventId],
      { displayStatus: "failed", activityStatus: "processed" },
      state.localSessionId
    );
  }
}

async function applySessionPatch(
  state: GuestIngestionState,
  message: ShareSessionPatchMessage
): Promise<void> {
  await rpc.remoteSharedSession.patch({
    request: {
      sessionId: state.localSessionId,
      name: message.patch.name,
      status: message.patch.mirrorStatus,
      repoName: message.patch.repoName,
      repoPath: message.patch.repoPath,
      model: message.patch.model,
      cliAgentType: message.patch.cliAgentType,
      totalTokens: message.patch.totalTokens,
      metadataJson: JSON.stringify(message.patch),
    },
  });
}

async function applyShareMessage(
  state: GuestIngestionState,
  message: ShareMessage
): Promise<void> {
  assertOrdered(state, message);
  if (message.type !== SHARE_MESSAGE_TYPE.BOOTSTRAP && !state.bootstrapped) {
    throw new Error("Received incremental share message before bootstrap.");
  }

  switch (message.type) {
    case SHARE_MESSAGE_TYPE.BOOTSTRAP:
      await applyBootstrap(state, message);
      break;
    case SHARE_MESSAGE_TYPE.EVENTS_APPEND:
      await applyEventsAppend(state, message);
      break;
    case SHARE_MESSAGE_TYPE.EVENT_UPSERT:
      await applyEventUpsert(state, message);
      break;
    case SHARE_MESSAGE_TYPE.EVENT_PATCH:
      await applyEventPatch(state, message);
      break;
    case SHARE_MESSAGE_TYPE.EVENT_REMOVE:
      await applyEventRemove(state, message);
      break;
    case SHARE_MESSAGE_TYPE.SESSION_PATCH:
      await applySessionPatch(state, message);
      break;
    case SHARE_MESSAGE_TYPE.END:
      await rpc.remoteSharedSession.patch({
        request: {
          sessionId: state.localSessionId,
          status: MIRROR_STATUS.ENDED,
          endedAt: new Date().toISOString(),
        },
      });
      break;
    default:
      break;
  }
}

export async function joinSharedSession(options: {
  offerCode: string;
  pin: string;
  sourceSessionId: string;
  shareId: string;
}): Promise<GuestSessionShareConnection> {
  const localSessionId = createLocalMirrorSessionId();
  const state: GuestIngestionState = {
    localSessionId,
    sourceSessionId: options.sourceSessionId,
    shareId: options.shareId,
    expectedSequence: 1,
    bootstrapped: false,
  };

  const handle: GuestShareHandle = await createGuestShareHandle({
    offerCode: options.offerCode,
    pin: options.pin,
    sourceSessionId: options.sourceSessionId,
    shareId: options.shareId,
    onMessage(message) {
      void applyShareMessage(state, message);
    },
  });

  return {
    localSessionId,
    shareId: options.shareId,
    sourceSessionId: options.sourceSessionId,
    answerCode: handle.answerCode,
    authenticated: handle.authenticated,
    getRecord(): Promise<RemoteSharedSessionRecord | null> {
      return rpc.remoteSharedSession.get({ sessionId: localSessionId });
    },
    sendViewerMessage(text: string, viewerLabel?: string): void {
      handle.send({
        type: SHARE_MESSAGE_TYPE.VIEWER_MESSAGE,
        version: SESSION_SHARE_PROTOCOL_VERSION,
        shareId: options.shareId,
        sourceSessionId: options.sourceSessionId,
        sequence: 0,
        operationId: `${options.shareId}:viewer:${Date.now()}`,
        text,
        viewerLabel,
        sentAt: new Date().toISOString(),
      });
    },
    async close(): Promise<void> {
      handle.close();
      await rpc.remoteSharedSession.patch({
        request: {
          sessionId: localSessionId,
          status: MIRROR_STATUS.DISCONNECTED,
        },
      });
    },
  };
}
