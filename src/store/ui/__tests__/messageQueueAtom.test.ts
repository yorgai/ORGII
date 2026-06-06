import { createStore } from "jotai/vanilla";

import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";

import {
  type QueueEditTarget,
  type QueuedMessage,
  clearSessionQueueAtom,
  dequeueMessageAtom,
  editMessageAtom,
  enqueueMessageAtom,
  forceSendMessageAtom,
  forceSendPendingQueueAtom,
  messageQueueAtom,
  queueEditTargetAtom,
  queueEditingAtom,
  reorderQueueAtom,
} from "../messageQueueAtom";

function makeMessage(
  overrides: Partial<QueuedMessage> & Pick<QueuedMessage, "id">
): QueuedMessage {
  return {
    sessionId: "session-1",
    content: `content-${overrides.id}`,
    displayContent: `display-${overrides.id}`,
    status: "queued",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("messageQueueAtom", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    store = createStore();
  });

  // =============================================
  // enqueueMessageAtom
  // =============================================

  describe("enqueueMessageAtom", () => {
    it("appends message to empty queue", () => {
      const msg = makeMessage({ id: "m1" });
      store.set(enqueueMessageAtom, msg);
      expect(store.get(messageQueueAtom)).toEqual([msg]);
    });

    it("appends message to existing queue (preserves order)", () => {
      const msg1 = makeMessage({ id: "m1" });
      const msg2 = makeMessage({ id: "m2" });
      store.set(enqueueMessageAtom, msg1);
      store.set(enqueueMessageAtom, msg2);
      expect(store.get(messageQueueAtom)).toEqual([msg1, msg2]);
    });

    it("preserves modelSelection snapshot when present", () => {
      const selection: LastModelSelection = {
        keySource: "hosted_key",
        listingModel: "tier-basic",
        listingModelDisplay: "Basic Tier",
      };
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m1", modelSelection: selection })
      );
      expect(store.get(messageQueueAtom)[0].modelSelection).toEqual(selection);
    });

    it("preserves imageDataUrls when present", () => {
      const images = ["data:image/png;base64,AAA", "data:image/png;base64,BBB"];
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m1", imageDataUrls: images })
      );
      expect(store.get(messageQueueAtom)[0].imageDataUrls).toEqual(images);
    });

    it("ignores duplicate enqueue requests for the same session and content", () => {
      const msg1 = makeMessage({
        id: "m1",
        content: "same",
        displayContent: "same display",
      });
      const msg2 = makeMessage({
        id: "m2",
        content: "same",
        displayContent: "same display",
      });
      store.set(enqueueMessageAtom, msg1);
      store.set(enqueueMessageAtom, msg2);
      expect(store.get(messageQueueAtom)).toEqual([msg1]);
    });
  });

  // =============================================
  // dequeueMessageAtom
  // =============================================

  describe("dequeueMessageAtom", () => {
    it("removes message by ID", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      store.set(enqueueMessageAtom, makeMessage({ id: "m2" }));
      store.set(enqueueMessageAtom, makeMessage({ id: "m3" }));

      store.set(dequeueMessageAtom, "m2");

      const ids = store.get(messageQueueAtom).map((m) => m.id);
      expect(ids).toEqual(["m1", "m3"]);
    });

    it("is a no-op when ID not found", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      store.set(dequeueMessageAtom, "unknown");
      expect(store.get(messageQueueAtom)).toHaveLength(1);
    });

    it("also removes matching force-send pending messages", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      store.set(forceSendMessageAtom, "m1");

      store.set(dequeueMessageAtom, "m1");

      expect(store.get(messageQueueAtom)).toEqual([]);
      expect(store.get(forceSendPendingQueueAtom)).toEqual([]);
    });
  });

  // =============================================
  // forceSendMessageAtom
  // =============================================

  describe("forceSendMessageAtom", () => {
    it("moves a visible queued message into the force-send pending queue", () => {
      const msg1 = makeMessage({ id: "m1" });
      const msg2 = makeMessage({ id: "m2" });
      store.set(enqueueMessageAtom, msg1);
      store.set(enqueueMessageAtom, msg2);

      store.set(forceSendMessageAtom, "m2");

      expect(store.get(messageQueueAtom)).toEqual([msg1]);
      expect(store.get(forceSendPendingQueueAtom)).toEqual([
        { ...msg2, requiresRuntimeSettle: false },
      ]);
    });

    it("keeps the force-sent message at pending priority without duplicating it", () => {
      const msg = makeMessage({ id: "m1" });
      store.set(enqueueMessageAtom, msg);

      store.set(forceSendMessageAtom, "m1");
      store.set(forceSendMessageAtom, "m1");

      expect(store.get(messageQueueAtom)).toEqual([]);
      expect(store.get(forceSendPendingQueueAtom)).toEqual([
        { ...msg, requiresRuntimeSettle: false },
      ]);
    });

    it("clears runtime-settle gating for explicit force-send", () => {
      const msg = makeMessage({ id: "m1", requiresRuntimeSettle: true });
      store.set(enqueueMessageAtom, msg);

      store.set(forceSendMessageAtom, "m1");

      expect(
        store.get(forceSendPendingQueueAtom)[0].requiresRuntimeSettle
      ).toBe(false);
    });

    it("is a no-op when ID is not in the visible queue", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));

      store.set(forceSendMessageAtom, "unknown");

      expect(store.get(messageQueueAtom)).toHaveLength(1);
      expect(store.get(forceSendPendingQueueAtom)).toHaveLength(0);
    });
  });

  // =============================================
  // clearSessionQueueAtom
  // =============================================

  describe("clearSessionQueueAtom", () => {
    it("removes all messages for a given sessionId", () => {
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m1", sessionId: "sess-a" })
      );
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m2", sessionId: "sess-a" })
      );

      store.set(clearSessionQueueAtom, "sess-a");
      expect(store.get(messageQueueAtom)).toHaveLength(0);
    });

    it("leaves messages from other sessions intact", () => {
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m1", sessionId: "sess-a" })
      );
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m2", sessionId: "sess-b" })
      );
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m3", sessionId: "sess-a" })
      );

      store.set(clearSessionQueueAtom, "sess-a");

      const remaining = store.get(messageQueueAtom);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("m2");
    });

    it("also clears force-send pending messages for the session", () => {
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m1", sessionId: "sess-a" })
      );
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m2", sessionId: "sess-b" })
      );
      store.set(forceSendMessageAtom, "m1");
      store.set(forceSendMessageAtom, "m2");

      store.set(clearSessionQueueAtom, "sess-a");

      expect(store.get(messageQueueAtom)).toEqual([]);
      expect(store.get(forceSendPendingQueueAtom).map((msg) => msg.id)).toEqual(
        ["m2"]
      );
    });
  });

  // =============================================
  // editMessageAtom
  // =============================================

  describe("editMessageAtom", () => {
    it("updates content and displayContent", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      store.set(editMessageAtom, { messageId: "m1", content: "updated" });

      const msg = store.get(messageQueueAtom)[0];
      expect(msg.content).toBe("updated");
      expect(msg.displayContent).toBe("updated");
    });

    it("updates imageDataUrls when provided", () => {
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m1", imageDataUrls: ["old.png"] })
      );
      store.set(editMessageAtom, {
        messageId: "m1",
        content: "same",
        imageDataUrls: ["new.png", "another.png"],
      });
      expect(store.get(messageQueueAtom)[0].imageDataUrls).toEqual([
        "new.png",
        "another.png",
      ]);
    });

    it("updates modelSelection when provided", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      const selection: LastModelSelection = {
        keySource: "own_key",
        provider: "anthropic",
        model: "claude-4",
      };
      store.set(editMessageAtom, {
        messageId: "m1",
        content: "same",
        modelSelection: selection,
      });
      expect(store.get(messageQueueAtom)[0].modelSelection).toEqual(selection);
    });

    it("does NOT overwrite imageDataUrls when field is omitted", () => {
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m1", imageDataUrls: ["keep.png"] })
      );
      store.set(editMessageAtom, { messageId: "m1", content: "new text" });
      expect(store.get(messageQueueAtom)[0].imageDataUrls).toEqual([
        "keep.png",
      ]);
    });

    it("does NOT overwrite modelSelection when field is omitted", () => {
      const selection: LastModelSelection = {
        keySource: "own_key",
        provider: "openai",
      };
      store.set(
        enqueueMessageAtom,
        makeMessage({ id: "m1", modelSelection: selection })
      );
      store.set(editMessageAtom, { messageId: "m1", content: "new" });
      expect(store.get(messageQueueAtom)[0].modelSelection).toEqual(selection);
    });

    it("is a no-op for non-matching messageId", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      store.set(editMessageAtom, { messageId: "unknown", content: "x" });
      expect(store.get(messageQueueAtom)[0].content).toBe("content-m1");
    });
  });

  // =============================================
  // reorderQueueAtom
  // =============================================

  describe("reorderQueueAtom", () => {
    it("moves item forward (higher to lower index)", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      store.set(enqueueMessageAtom, makeMessage({ id: "m2" }));
      store.set(enqueueMessageAtom, makeMessage({ id: "m3" }));

      store.set(reorderQueueAtom, { fromIndex: 2, toIndex: 0 });

      const ids = store.get(messageQueueAtom).map((m) => m.id);
      expect(ids).toEqual(["m3", "m1", "m2"]);
    });

    it("moves item backward (lower to higher index)", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      store.set(enqueueMessageAtom, makeMessage({ id: "m2" }));
      store.set(enqueueMessageAtom, makeMessage({ id: "m3" }));

      store.set(reorderQueueAtom, { fromIndex: 0, toIndex: 2 });

      const ids = store.get(messageQueueAtom).map((m) => m.id);
      expect(ids).toEqual(["m2", "m3", "m1"]);
    });

    it("is a no-op when fromIndex === toIndex", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      store.set(enqueueMessageAtom, makeMessage({ id: "m2" }));

      store.set(reorderQueueAtom, { fromIndex: 0, toIndex: 0 });

      const ids = store.get(messageQueueAtom).map((m) => m.id);
      expect(ids).toEqual(["m1", "m2"]);
    });

    it("is a no-op for out-of-bounds indices", () => {
      store.set(enqueueMessageAtom, makeMessage({ id: "m1" }));
      store.set(enqueueMessageAtom, makeMessage({ id: "m2" }));

      store.set(reorderQueueAtom, { fromIndex: -1, toIndex: 0 });
      expect(store.get(messageQueueAtom).map((m) => m.id)).toEqual([
        "m1",
        "m2",
      ]);

      store.set(reorderQueueAtom, { fromIndex: 0, toIndex: 5 });
      expect(store.get(messageQueueAtom).map((m) => m.id)).toEqual([
        "m1",
        "m2",
      ]);
    });
  });

  // =============================================
  // queueEditingAtom (derived)
  // =============================================

  describe("queueEditingAtom", () => {
    it("returns false when queueEditTargetAtom is null", () => {
      expect(store.get(queueEditingAtom)).toBe(false);
    });

    it("returns true when queueEditTargetAtom has a value", () => {
      const target: QueueEditTarget = { messageId: "m1", content: "hello" };
      store.set(queueEditTargetAtom, target);
      expect(store.get(queueEditingAtom)).toBe(true);
    });

    it("resets to false when queueEditTargetAtom is cleared", () => {
      store.set(queueEditTargetAtom, { messageId: "m1", content: "x" });
      expect(store.get(queueEditingAtom)).toBe(true);

      store.set(queueEditTargetAtom, null);
      expect(store.get(queueEditingAtom)).toBe(false);
    });

    it("stores imageDataUrls on the edit target", () => {
      const target: QueueEditTarget = {
        messageId: "m1",
        content: "hello",
        imageDataUrls: ["img1.png", "img2.png"],
      };
      store.set(queueEditTargetAtom, target);
      expect(store.get(queueEditTargetAtom)?.imageDataUrls).toEqual([
        "img1.png",
        "img2.png",
      ]);
    });
  });
});
