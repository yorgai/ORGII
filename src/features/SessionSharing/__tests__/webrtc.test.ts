import { describe, expect, it } from "vitest";

import {
  SESSION_SHARE_PROTOCOL_VERSION,
  SHARE_MESSAGE_TYPE,
  type ShareAckMessage,
} from "../types";
import { parseShareMessage } from "../webrtc";

describe("SessionSharing WebRTC protocol helpers", () => {
  it("parses valid share messages", () => {
    const message: ShareAckMessage = {
      type: SHARE_MESSAGE_TYPE.ACK,
      version: SESSION_SHARE_PROTOCOL_VERSION,
      shareId: "share-1",
      sourceSessionId: "cliagent-1",
      sequence: 1,
      operationId: "op-1",
      ackSequence: 1,
    };

    expect(parseShareMessage(JSON.stringify(message))).toEqual(message);
  });

  it("rejects unsupported protocol versions", () => {
    const message = {
      type: SHARE_MESSAGE_TYPE.ACK,
      version: 99,
      shareId: "share-1",
      sourceSessionId: "cliagent-1",
      sequence: 1,
      operationId: "op-1",
      ackSequence: 1,
    };

    expect(() => parseShareMessage(JSON.stringify(message))).toThrow(
      "Unsupported share protocol version"
    );
  });
});
