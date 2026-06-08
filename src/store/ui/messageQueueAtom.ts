import { atom } from "jotai";

import type { AgentExecMode } from "@src/config/sessionCreatorConfig";
import type { LastModelSelection } from "@src/store/session/creatorDefaultModelAtom";

// ============================================
// Types
// ============================================

export interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  displayContent: string;
  imageDataUrls?: string[];
  /**
   * Snapshot of model/account selection at enqueue time. Frozen here
   * so a model swap done while the queue is draining cannot retroactively
   * change which model an already-queued message is sent with.
   */
  modelSelection?: LastModelSelection;
  /**
   * Snapshot of the agent exec mode at enqueue time. Same rationale as
   * `modelSelection` — without this snapshot, switching from Plan to
   * Build mid-queue (or being switched by the `mode_switch` card) would
   * silently re-target every still-pending message in the queue.
   * `undefined` means "use whatever mode the session row has at dispatch
   * time" (which is the legacy behaviour and what callers that don't
   * care about a specific mode should keep doing).
   */
  agentExecMode?: AgentExecMode;
  /**
   * True when this was enqueued while a turn was active/pending. It must not
   * dispatch until the queue watcher observes a terminal edge after enqueue.
   */
  requiresRuntimeSettle?: boolean;
  /**
   * Rust-native active turn id observed at enqueue time. When present, natural
   * queue release must be driven by that exact turn's terminal event rather
   * than by session-level status edges, which can briefly flap during tool use.
   */
  releaseAfterTurnId?: string;
  /**
   * User explicitly pressed Send after Stop restored the draft while Rust was
   * still winding down. This message is the next active prompt once cancel
   * settles; older queued follow-ups must stay parked behind it.
   */
  dispatchAfterUserCancel?: boolean;
  status: "queued";
  createdAt: string;
}

// ============================================
// Core Atom
// ============================================

export const messageQueueAtom = atom<QueuedMessage[]>([]);
messageQueueAtom.debugLabel = "messageQueueAtom";

export const forceSendPendingQueueAtom = atom<QueuedMessage[]>([]);
forceSendPendingQueueAtom.debugLabel = "forceSendPendingQueueAtom";

/** Tracks which queued message is currently being edited in the main input box. */
export interface QueueEditTarget {
  messageId: string;
  content: string;
  imageDataUrls?: string[];
}
export const queueEditTargetAtom = atom<QueueEditTarget | null>(null);
queueEditTargetAtom.debugLabel = "queueEditTargetAtom";

/** True while a queued message is being edited — dispatch is paused. Derived from queueEditTargetAtom. */
export const queueEditingAtom = atom(
  (get) => get(queueEditTargetAtom) !== null
);
queueEditingAtom.debugLabel = "queueEditingAtom";

// ============================================
// Write Atoms
// ============================================

/**
 * Incremented each time a message is enqueued.
 * Components can watch this to react to new enqueues without using effects.
 */
export const enqueueCountAtom = atom(0);
enqueueCountAtom.debugLabel = "enqueueCountAtom";

export const enqueueMessageAtom = atom(
  null,
  (_get, set, message: QueuedMessage) => {
    let added = false;
    const targetAtom = message.dispatchAfterUserCancel
      ? forceSendPendingQueueAtom
      : messageQueueAtom;
    set(targetAtom, (prev) => {
      const duplicate = prev.some(
        (existing) =>
          existing.sessionId === message.sessionId &&
          existing.content === message.content &&
          existing.displayContent === message.displayContent
      );
      if (duplicate) return prev;
      added = true;
      return [
        ...prev,
        message.dispatchAfterUserCancel
          ? { ...message, requiresRuntimeSettle: false }
          : message,
      ];
    });
    if (added) set(enqueueCountAtom, (n) => n + 1);
  }
);
enqueueMessageAtom.debugLabel = "enqueueMessageAtom";

export const dequeueMessageAtom = atom(null, (_get, set, messageId: string) => {
  set(messageQueueAtom, (prev) => prev.filter((msg) => msg.id !== messageId));
  set(forceSendPendingQueueAtom, (prev) =>
    prev.filter((msg) => msg.id !== messageId)
  );
});
dequeueMessageAtom.debugLabel = "dequeueMessageAtom";

export const forceSendMessageAtom = atom(
  null,
  (get, set, messageId: string) => {
    const message = get(messageQueueAtom).find((msg) => msg.id === messageId);
    if (!message) return;
    set(messageQueueAtom, (prev) => prev.filter((msg) => msg.id !== messageId));
    set(forceSendPendingQueueAtom, (prev) => {
      const duplicate = prev.some((msg) => msg.id === messageId);
      return duplicate
        ? prev
        : [{ ...message, requiresRuntimeSettle: false }, ...prev];
    });
  }
);
forceSendMessageAtom.debugLabel = "forceSendMessageAtom";

export const clearSessionQueueAtom = atom(
  null,
  (_get, set, sessionId: string) => {
    set(messageQueueAtom, (prev) =>
      prev.filter((msg) => msg.sessionId !== sessionId)
    );
    set(forceSendPendingQueueAtom, (prev) =>
      prev.filter((msg) => msg.sessionId !== sessionId)
    );
  }
);
clearSessionQueueAtom.debugLabel = "clearSessionQueueAtom";

export const editMessageAtom = atom(
  null,
  (
    _get,
    set,
    update: {
      messageId: string;
      content: string;
      imageDataUrls?: string[];
      modelSelection?: LastModelSelection;
      agentExecMode?: AgentExecMode;
    }
  ) => {
    set(messageQueueAtom, (prev) =>
      prev.map((msg) =>
        msg.id === update.messageId
          ? {
              ...msg,
              content: update.content,
              displayContent: update.content,
              ...(update.imageDataUrls !== undefined && {
                imageDataUrls: update.imageDataUrls,
              }),
              ...(update.modelSelection !== undefined && {
                modelSelection: update.modelSelection,
              }),
              ...(update.agentExecMode !== undefined && {
                agentExecMode: update.agentExecMode,
              }),
            }
          : msg
      )
    );
  }
);
editMessageAtom.debugLabel = "editMessageAtom";

/**
 * Bumped to request an immediate queue flush when the session is idle.
 * Watched by useQueueDispatch to trigger tryDispatchNext on demand
 * (e.g. "Send Now" while the agent is not running).
 */
export const queueFlushRequestAtom = atom(0);
queueFlushRequestAtom.debugLabel = "queueFlushRequest";

export const reorderQueueAtom = atom(
  null,
  (
    _get,
    set,
    { fromIndex, toIndex }: { fromIndex: number; toIndex: number }
  ) => {
    set(messageQueueAtom, (prev) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }
);
reorderQueueAtom.debugLabel = "reorderQueueAtom";
