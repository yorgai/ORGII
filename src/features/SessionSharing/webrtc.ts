import {
  computeShareChallengeResponse,
  createShareChallenge,
  decryptSharePayload,
  encryptSharePayload,
  verifyShareChallengeResponse,
} from "./crypto";
import {
  SESSION_SHARE_PROTOCOL_VERSION,
  SHARE_MESSAGE_TYPE,
  type ShareMessage,
} from "./types";

export const SESSION_SHARE_DATA_CHANNEL = "orgii-session-share" as const;

export const SESSION_SHARE_ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export interface EncodedSessionDescription {
  type: RTCSdpType;
  sdp: string;
  sourceSessionId?: string;
  shareId?: string;
}

export interface DecodedShareOffer {
  description: RTCSessionDescriptionInit;
  sourceSessionId: string;
  shareId: string;
}

export interface HostShareHandle {
  shareId: string;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  offerCode: string;
  authenticated: Promise<void>;
  acceptAnswer(answerCode: string): Promise<void>;
  send(message: ShareMessage): void;
  close(): void;
}

export interface GuestShareHandle {
  shareId: string;
  peerConnection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  answerCode: string;
  authenticated: Promise<void>;
  send(message: ShareMessage): void;
  close(): void;
}

export function isWebRtcAvailable(): boolean {
  return (
    typeof RTCPeerConnection !== "undefined" &&
    typeof RTCSessionDescription !== "undefined"
  );
}

function assertWebRtcAvailable(): void {
  if (!isWebRtcAvailable()) {
    throw new Error("WebRTC is not available in this Tauri webview.");
  }
}

function randomId(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

function waitForIceGathering(peerConnection: RTCPeerConnection): Promise<void> {
  if (peerConnection.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const handleStateChange = () => {
      if (peerConnection.iceGatheringState === "complete") {
        peerConnection.removeEventListener(
          "icegatheringstatechange",
          handleStateChange
        );
        resolve();
      }
    };
    peerConnection.addEventListener(
      "icegatheringstatechange",
      handleStateChange
    );
  });
}

function requireLocalDescription(
  peerConnection: RTCPeerConnection
): EncodedSessionDescription {
  const description = peerConnection.localDescription;
  if (!description?.sdp) {
    throw new Error("Missing local WebRTC session description.");
  }
  return { type: description.type, sdp: description.sdp };
}

async function encodeDescription(
  description: EncodedSessionDescription,
  pin: string
): Promise<string> {
  return encryptSharePayload(JSON.stringify(description), pin);
}

async function decodeDescription(
  code: string,
  pin: string
): Promise<EncodedSessionDescription> {
  const plaintext = await decryptSharePayload(code, pin);
  const parsed = JSON.parse(plaintext) as EncodedSessionDescription;
  if (!parsed.sdp || !parsed.type) {
    throw new Error("Share code does not contain a valid session description.");
  }
  return parsed;
}

export async function decodeShareOffer(
  code: string,
  pin: string
): Promise<DecodedShareOffer> {
  const decoded = await decodeDescription(code, pin);
  if (!decoded.sourceSessionId || !decoded.shareId) {
    throw new Error("Share offer is missing source session metadata.");
  }
  return {
    description: { type: decoded.type, sdp: decoded.sdp },
    sourceSessionId: decoded.sourceSessionId,
    shareId: decoded.shareId,
  };
}

export function sendShareMessage(
  channel: RTCDataChannel,
  message: ShareMessage
): void {
  if (channel.readyState !== "open") {
    throw new Error("Share data channel is not open.");
  }
  channel.send(JSON.stringify(message));
}

export function parseShareMessage(raw: string): ShareMessage {
  const parsed = JSON.parse(raw) as ShareMessage;
  if (parsed.version !== SESSION_SHARE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported share protocol version: ${parsed.version}`);
  }
  if (!parsed.type || !parsed.shareId || !parsed.sourceSessionId) {
    throw new Error("Invalid share message envelope.");
  }
  return parsed;
}

function createAuthGate(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolveGate: (() => void) | undefined;
  let rejectGate: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolveGate = resolve;
    rejectGate = reject;
  });
  return {
    promise,
    resolve: () => resolveGate?.(),
    reject: (error: Error) => rejectGate?.(error),
  };
}

function createBaseMessage<TType extends ShareMessage["type"]>(
  shareId: string,
  sourceSessionId: string,
  type: TType
) {
  return {
    type,
    version: SESSION_SHARE_PROTOCOL_VERSION,
    shareId,
    sourceSessionId,
    sequence: 0,
    operationId: randomId("shareop"),
  };
}

export async function createHostShareHandle(options: {
  sourceSessionId: string;
  pin: string;
  shareId?: string;
  onAuthenticated?: (channel: RTCDataChannel) => void;
  onMessage?: (message: ShareMessage) => void;
}): Promise<HostShareHandle> {
  assertWebRtcAvailable();
  const shareId = options.shareId ?? randomId("share");
  const authGate = createAuthGate();
  const peerConnection = new RTCPeerConnection(SESSION_SHARE_ICE_CONFIG);
  const dataChannel = peerConnection.createDataChannel(
    SESSION_SHARE_DATA_CHANNEL,
    {
      ordered: true,
    }
  );
  const challenge = createShareChallenge();

  dataChannel.addEventListener("open", () => {
    sendShareMessage(dataChannel, {
      ...createBaseMessage(
        shareId,
        options.sourceSessionId,
        SHARE_MESSAGE_TYPE.AUTH_CHALLENGE
      ),
      challenge,
    });
  });
  dataChannel.addEventListener("message", (event) => {
    try {
      const message = parseShareMessage(String(event.data));
      if (message.type === SHARE_MESSAGE_TYPE.AUTH_RESPONSE) {
        void verifyShareChallengeResponse(
          challenge,
          message.response,
          options.pin,
          shareId
        ).then((ok) => {
          const resultMessage = {
            ...createBaseMessage(
              shareId,
              options.sourceSessionId,
              SHARE_MESSAGE_TYPE.AUTH_RESULT
            ),
            ok,
            ...(ok ? {} : { reason: "Invalid PIN response." }),
          };
          sendShareMessage(dataChannel, resultMessage);
          if (ok) {
            authGate.resolve();
            options.onAuthenticated?.(dataChannel);
          } else {
            authGate.reject(new Error("Guest failed share authentication."));
          }
        });
        return;
      }
      options.onMessage?.(message);
    } catch (err) {
      authGate.reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
  dataChannel.addEventListener("error", () => {
    authGate.reject(new Error("Share data channel failed."));
  });

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await waitForIceGathering(peerConnection);
  const offerCode = await encodeDescription(
    {
      ...requireLocalDescription(peerConnection),
      sourceSessionId: options.sourceSessionId,
      shareId,
    },
    options.pin
  );

  return {
    shareId,
    peerConnection,
    dataChannel,
    offerCode,
    authenticated: authGate.promise,
    async acceptAnswer(answerCode: string): Promise<void> {
      const answer = await decodeDescription(answerCode, options.pin);
      await peerConnection.setRemoteDescription(answer);
    },
    send(message: ShareMessage): void {
      sendShareMessage(dataChannel, message);
    },
    close(): void {
      dataChannel.close();
      peerConnection.close();
    },
  };
}

export async function createGuestShareHandle(options: {
  offerCode: string;
  pin: string;
  sourceSessionId: string;
  shareId: string;
  onAuthenticated?: (channel: RTCDataChannel) => void;
  onMessage?: (message: ShareMessage) => void;
}): Promise<GuestShareHandle> {
  assertWebRtcAvailable();
  const authGate = createAuthGate();
  const peerConnection = new RTCPeerConnection(SESSION_SHARE_ICE_CONFIG);
  const dataChannelPromise = new Promise<RTCDataChannel>((resolve) => {
    peerConnection.addEventListener("datachannel", (event) => {
      resolve(event.channel);
    });
  });

  const offer = await decodeShareOffer(options.offerCode, options.pin);
  if (
    offer.sourceSessionId !== options.sourceSessionId ||
    offer.shareId !== options.shareId
  ) {
    throw new Error(
      "Share offer metadata does not match the requested session."
    );
  }
  await peerConnection.setRemoteDescription(offer.description);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await waitForIceGathering(peerConnection);
  const answerCode = await encodeDescription(
    requireLocalDescription(peerConnection),
    options.pin
  );
  const dataChannel = await dataChannelPromise;

  dataChannel.addEventListener("message", (event) => {
    try {
      const message = parseShareMessage(String(event.data));
      if (message.type === SHARE_MESSAGE_TYPE.AUTH_CHALLENGE) {
        void computeShareChallengeResponse(
          message.challenge,
          options.pin,
          options.shareId
        ).then((response) => {
          sendShareMessage(dataChannel, {
            ...createBaseMessage(
              options.shareId,
              options.sourceSessionId,
              SHARE_MESSAGE_TYPE.AUTH_RESPONSE
            ),
            response,
          });
        });
        return;
      }
      if (message.type === SHARE_MESSAGE_TYPE.AUTH_RESULT) {
        if (message.ok) {
          authGate.resolve();
          options.onAuthenticated?.(dataChannel);
        } else {
          authGate.reject(
            new Error(message.reason ?? "Share authentication failed.")
          );
        }
        return;
      }
      options.onMessage?.(message);
    } catch (err) {
      authGate.reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
  dataChannel.addEventListener("error", () => {
    authGate.reject(new Error("Share data channel failed."));
  });

  return {
    shareId: options.shareId,
    peerConnection,
    dataChannel,
    answerCode,
    authenticated: authGate.promise,
    send(message: ShareMessage): void {
      sendShareMessage(dataChannel, message);
    },
    close(): void {
      dataChannel.close();
      peerConnection.close();
    },
  };
}
