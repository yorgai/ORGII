import type { DispatchCategory } from "@src/api/tauri/session";
import type { CliAgentType } from "@src/api/types/keys";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

export const SESSION_SHARE_PROTOCOL_VERSION = 1 as const;
export const SESSION_SHARE_CODE_PREFIX = "ORGII-SHARE" as const;

export const SHARE_MODE = {
  READONLY: "readonly",
} as const;

export type ShareMode = (typeof SHARE_MODE)[keyof typeof SHARE_MODE];

export const SHARE_MESSAGE_TYPE = {
  AUTH_CHALLENGE: "share:auth_challenge",
  AUTH_RESPONSE: "share:auth_response",
  AUTH_RESULT: "share:auth_result",
  BOOTSTRAP: "share:bootstrap",
  SESSION_PATCH: "share:session_patch",
  EVENTS_APPEND: "share:events_append",
  EVENT_UPSERT: "share:event_upsert",
  EVENT_PATCH: "share:event_patch",
  EVENT_REMOVE: "share:event_remove",
  VIEWER_MESSAGE: "share:viewer_message",
  ACK: "share:ack",
  RESYNC_REQUEST: "share:resync_request",
  END: "share:end",
} as const;

export type ShareMessageType =
  (typeof SHARE_MESSAGE_TYPE)[keyof typeof SHARE_MESSAGE_TYPE];

export const MIRROR_STATUS = {
  CONNECTING: "connecting",
  LIVE: "live",
  DISCONNECTED: "disconnected",
  ENDED: "ended",
} as const;

export type MirrorStatus = (typeof MIRROR_STATUS)[keyof typeof MIRROR_STATUS];

export interface ShareEnvelopeBase {
  type: ShareMessageType;
  version: typeof SESSION_SHARE_PROTOCOL_VERSION;
  shareId: string;
  sourceSessionId: string;
  sequence: number;
  operationId: string;
}

export interface ShareSourceMetadata {
  sourceSessionId: string;
  name: string;
  sourceCategory: DispatchCategory;
  cliAgentType?: CliAgentType;
  model?: string;
  keySource?: string;
  repoName?: string;
  repoPath?: string;
  createdAt?: string;
  updatedAt?: string;
  totalTokens?: number;
}

export interface ShareMetadata {
  shareId: string;
  shareMode: ShareMode;
  hostPeerLabel?: string;
}

export interface ShareBootstrapPayload {
  source: ShareSourceMetadata;
  share: ShareMetadata;
  events: SessionEvent[];
}

export interface ShareAuthChallengeMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.AUTH_CHALLENGE;
  challenge: string;
}

export interface ShareAuthResponseMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.AUTH_RESPONSE;
  response: string;
}

export interface ShareAuthResultMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.AUTH_RESULT;
  ok: boolean;
  reason?: string;
}

export interface ShareBootstrapMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.BOOTSTRAP;
  payload: ShareBootstrapPayload;
}

export interface ShareSessionPatchMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.SESSION_PATCH;
  patch: Partial<ShareSourceMetadata> & { mirrorStatus?: MirrorStatus };
}

export interface ShareEventsAppendMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.EVENTS_APPEND;
  events: SessionEvent[];
}

export interface ShareEventUpsertMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.EVENT_UPSERT;
  event: SessionEvent;
}

export interface ShareEventPatchMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.EVENT_PATCH;
  eventId: string;
  patch: Partial<SessionEvent>;
}

export interface ShareEventRemoveMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.EVENT_REMOVE;
  eventId?: string;
  eventIdPrefix?: string;
}

export interface ShareViewerMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.VIEWER_MESSAGE;
  text: string;
  viewerLabel?: string;
  sentAt: string;
}

export interface ShareAckMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.ACK;
  ackSequence: number;
}

export interface ShareResyncRequestMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.RESYNC_REQUEST;
  expectedSequence: number;
  receivedSequence: number;
}

export interface ShareEndMessage extends ShareEnvelopeBase {
  type: typeof SHARE_MESSAGE_TYPE.END;
  reason?: string;
}

export type ShareMessage =
  | ShareAuthChallengeMessage
  | ShareAuthResponseMessage
  | ShareAuthResultMessage
  | ShareBootstrapMessage
  | ShareSessionPatchMessage
  | ShareEventsAppendMessage
  | ShareEventUpsertMessage
  | ShareEventPatchMessage
  | ShareEventRemoveMessage
  | ShareViewerMessage
  | ShareAckMessage
  | ShareResyncRequestMessage
  | ShareEndMessage;

export interface EncryptedShareCodePayload {
  version: typeof SESSION_SHARE_PROTOCOL_VERSION;
  salt: string;
  iv: string;
  ciphertext: string;
}
