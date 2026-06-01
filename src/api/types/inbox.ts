/**
 * Inbox domain types.
 *
 * Canonical home for types shared between the store layer (inboxAtom) and the
 * Inbox module UI. Lives here so src/store/ does not need to reach into a
 * specific module's types file.
 */
import type { WorkItem } from "@src/types/core/workItem";

export type InboxCategory = "promotion" | "git" | "workitems";

export type MessagePriority = "urgent" | "high" | "medium" | "low" | "none";

export type MessageStatus = "unread" | "read" | "archived";

export interface InboxMessage {
  id: string;
  title: string;
  preview: string;
  content: string;
  category: InboxCategory;
  priority: MessagePriority;
  status: MessageStatus;
  createdAt: string;
  updatedAt: string;
  sender?: {
    name: string;
    avatar?: string;
  };
  metadata?: {
    repoName?: string;
    branch?: string;
    commitHash?: string;
    projectName?: string;
    workItemId?: string;
    workItemStatus?: string;
    promotionType?: string;
    expiresAt?: string;
    actionUrl?: string;
  };
  labels?: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  workItem?: WorkItem;
}

export interface DateGroup {
  dateKey: string;
  label: string;
  messages: InboxMessage[];
}
