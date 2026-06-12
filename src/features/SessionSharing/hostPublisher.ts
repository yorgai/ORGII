import { rpc } from "@src/api/tauri/rpc";
import type { SessionAggregateRecord } from "@src/api/tauri/rpc/schemas/sessionAggregate";
import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
import { eventStoreProxy } from "@src/engines/SessionCore/core/store";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  SESSION_SHARE_PROTOCOL_VERSION,
  SHARE_MESSAGE_TYPE,
  SHARE_MODE,
  type ShareBootstrapMessage,
  type ShareMessage,
  type ShareSourceMetadata,
  type ShareViewerMessage,
} from "./types";
import {
  type HostShareHandle,
  createHostShareHandle,
  sendShareMessage,
} from "./webrtc";

export interface HostSessionSharePublisher {
  shareId: string;
  offerCode: string;
  acceptAnswer(answerCode: string): Promise<void>;
  stop(): void;
  onViewerMessage(listener: (message: ShareViewerMessage) => void): () => void;
}

interface PublisherState {
  sequence: number;
  sentEventIds: Set<string>;
  resendBuffer: ShareMessage[];
}

const RESEND_BUFFER_LIMIT = 200;

function isShareableCategory(
  category: SessionAggregateRecord["category"]
): boolean {
  return (
    category === DISPATCH_CATEGORY.CLI_AGENT ||
    category === DISPATCH_CATEGORY.RUST_AGENT
  );
}

function createOperationId(
  shareId: string,
  sequence: number,
  suffix: string
): string {
  return `${shareId}:${sequence}:${suffix}`;
}

function nextSequence(state: PublisherState): number {
  state.sequence += 1;
  return state.sequence;
}

function rememberMessage(state: PublisherState, message: ShareMessage): void {
  state.resendBuffer.push(message);
  if (state.resendBuffer.length > RESEND_BUFFER_LIMIT) {
    state.resendBuffer.splice(
      0,
      state.resendBuffer.length - RESEND_BUFFER_LIMIT
    );
  }
}

function toSourceMetadata(
  session: SessionAggregateRecord
): ShareSourceMetadata {
  return {
    sourceSessionId: session.sessionId,
    name: session.name,
    sourceCategory: session.category,
    cliAgentType: session.cliAgentType,
    model: session.model,
    keySource: session.keySource,
    repoName: session.repoName,
    repoPath: session.repoPath,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    totalTokens: session.totalTokens,
  };
}

async function loadAggregateRecord(
  sessionId: string
): Promise<SessionAggregateRecord> {
  const response = await rpc.sessionAggregate.list({ filter: { limit: 1 } });
  const directMatch = response.sessions.find(
    (session) => session.sessionId === sessionId
  );
  if (directMatch) return directMatch;

  const unbounded = await rpc.sessionAggregate.list({});
  const session = unbounded.sessions.find(
    (record) => record.sessionId === sessionId
  );
  if (!session) {
    throw new Error(`Session not found for sharing: ${sessionId}`);
  }
  return session;
}

function rewriteBootstrapEvents(
  events: SessionEvent[],
  sourceSessionId: string
): SessionEvent[] {
  return events.map((event) => ({ ...event, sessionId: sourceSessionId }));
}

function buildBootstrapMessage(options: {
  shareId: string;
  sourceSessionId: string;
  sequence: number;
  operationId: string;
  source: ShareSourceMetadata;
  events: SessionEvent[];
  hostPeerLabel?: string;
}): ShareBootstrapMessage {
  return {
    type: SHARE_MESSAGE_TYPE.BOOTSTRAP,
    version: SESSION_SHARE_PROTOCOL_VERSION,
    shareId: options.shareId,
    sourceSessionId: options.sourceSessionId,
    sequence: options.sequence,
    operationId: options.operationId,
    payload: {
      source: options.source,
      share: {
        shareId: options.shareId,
        shareMode: SHARE_MODE.READONLY,
        hostPeerLabel: options.hostPeerLabel,
      },
      events: options.events,
    },
  };
}

function sendWithBuffer(
  handle: HostShareHandle,
  state: PublisherState,
  message: ShareMessage
): void {
  handle.send(message);
  rememberMessage(state, message);
}

export async function startHostSessionShare(options: {
  sessionId: string;
  pin: string;
  hostPeerLabel?: string;
}): Promise<HostSessionSharePublisher> {
  const session = await loadAggregateRecord(options.sessionId);
  if (!isShareableCategory(session.category)) {
    throw new Error("Only CLI and Rust agent sessions can be shared.");
  }

  const initialEvents = await rpc.sessionCore.eventStore.getEvents({
    sessionId: options.sessionId,
  });
  const state: PublisherState = {
    sequence: 0,
    sentEventIds: new Set(initialEvents.map((event) => event.id)),
    resendBuffer: [],
  };
  const viewerMessageListeners = new Set<
    (message: ShareViewerMessage) => void
  >();
  let unsubscribeSnapshot: (() => void) | undefined;

  const hostHandle = await createHostShareHandle({
    sourceSessionId: options.sessionId,
    pin: options.pin,
    onAuthenticated(channel) {
      const sequence = nextSequence(state);
      const bootstrap = buildBootstrapMessage({
        shareId: hostHandle.shareId,
        sourceSessionId: options.sessionId,
        sequence,
        operationId: createOperationId(
          hostHandle.shareId,
          sequence,
          "bootstrap"
        ),
        source: toSourceMetadata(session),
        events: rewriteBootstrapEvents(initialEvents, options.sessionId),
        hostPeerLabel: options.hostPeerLabel,
      });
      sendShareMessage(channel, bootstrap);
      rememberMessage(state, bootstrap);

      unsubscribeSnapshot = eventStoreProxy.subscribeSession(
        options.sessionId,
        (snapshot) => {
          const snapshotEvents =
            "events" in snapshot ? snapshot.events : snapshot.chatEvents;
          const newEvents = snapshotEvents.filter(
            (event) => !state.sentEventIds.has(event.id)
          );
          if (newEvents.length === 0) return;
          for (const event of newEvents) {
            state.sentEventIds.add(event.id);
          }
          const appendSequence = nextSequence(state);
          sendWithBuffer(hostHandle, state, {
            type: SHARE_MESSAGE_TYPE.EVENTS_APPEND,
            version: SESSION_SHARE_PROTOCOL_VERSION,
            shareId: hostHandle.shareId,
            sourceSessionId: options.sessionId,
            sequence: appendSequence,
            operationId: createOperationId(
              hostHandle.shareId,
              appendSequence,
              "events_append"
            ),
            events: rewriteBootstrapEvents(newEvents, options.sessionId),
          });
        }
      );
    },
    onMessage(message) {
      if (message.type === SHARE_MESSAGE_TYPE.VIEWER_MESSAGE) {
        for (const listener of viewerMessageListeners) {
          listener(message);
        }
      }
    },
  });

  return {
    shareId: hostHandle.shareId,
    offerCode: hostHandle.offerCode,
    acceptAnswer(answerCode: string): Promise<void> {
      return hostHandle.acceptAnswer(answerCode);
    },
    stop(): void {
      unsubscribeSnapshot?.();
      const sequence = nextSequence(state);
      try {
        sendWithBuffer(hostHandle, state, {
          type: SHARE_MESSAGE_TYPE.END,
          version: SESSION_SHARE_PROTOCOL_VERSION,
          shareId: hostHandle.shareId,
          sourceSessionId: options.sessionId,
          sequence,
          operationId: createOperationId(hostHandle.shareId, sequence, "end"),
          reason: "Host stopped sharing.",
        });
      } catch {
        // The channel may already be closed by the peer; close handles below.
      }
      hostHandle.close();
    },
    onViewerMessage(
      listener: (message: ShareViewerMessage) => void
    ): () => void {
      viewerMessageListeners.add(listener);
      return () => viewerMessageListeners.delete(listener);
    },
  };
}
