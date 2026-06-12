import { atom } from "jotai";

import type { GuestSessionShareConnection } from "./guestIngestion";
import type { ShareViewerMessage } from "./types";

export interface HostViewerMessageToast {
  id: string;
  shareId: string;
  text: string;
  viewerLabel?: string;
  createdAt: number;
}

export const activeGuestShareConnectionsAtom = atom<
  Record<string, GuestSessionShareConnection>
>({});

export const hostViewerMessagesAtom = atom<HostViewerMessageToast[]>([]);

export function createViewerMessageToast(
  message: ShareViewerMessage
): HostViewerMessageToast {
  return {
    id: `${message.shareId}:${message.sequence}:${message.operationId}`,
    shareId: message.shareId,
    text: message.text,
    viewerLabel: message.viewerLabel,
    createdAt: Date.now(),
  };
}
