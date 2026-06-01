/**
 * useWorkItemInboxNotifications
 *
 * Bridges work item assignment changes to the inbox notification system.
 *
 * Usage: Call this hook in the WorkItems root component, passing the
 * members list. It returns an `onAssignmentChanges` callback to pass
 * to useWorkItemsSource.
 *
 * Flow:
 * 1. useWorkItemsSource detects assignee diffs after sync/pull
 * 2. Calls onAssignmentChanges with the changes + members
 * 3. This hook filters for current-user-relevant changes
 * 4. Converts to InboxMessages and upserts via inboxAtom
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MemberEntry } from "@src/api/http/project";
import { findMemberIdsByUser } from "@src/hooks/project";
import type { AssignmentChange } from "@src/modules/ProjectManager/WorkItems/types";
import { upsertInboxMessageAtom } from "@src/store/ui/inboxAtom";
import { userAtom } from "@src/store/user/userAtom";

import { filterAndConvertAssignmentChanges } from "./assignmentConverter";

interface GitUserIdentity {
  email: string | null;
  name: string | null;
  github_username: string | null;
}

export function useWorkItemInboxNotifications() {
  const upsertMessage = useSetAtom(upsertInboxMessageAtom);
  const user = useAtomValue(userAtom);

  // Fetch local git identity on mount
  const [gitIdentity, setGitIdentity] = useState<GitUserIdentity | null>(null);
  useEffect(() => {
    let cancelled = false;
    invoke<GitUserIdentity>("get_git_user_identity", { repoPath: null })
      .then((identity) => {
        if (!cancelled) setGitIdentity(identity);
      })
      .catch(() => {
        /* ignore — fallback to userAtom */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  const gitIdentityRef = useRef(gitIdentity);
  useEffect(() => {
    gitIdentityRef.current = gitIdentity;
  }, [gitIdentity]);

  const onAssignmentChanges = useCallback(
    (changes: AssignmentChange[], members: MemberEntry[]) => {
      const currentUserMemberIds = findMemberIdsByUser(
        members,
        userRef.current,
        gitIdentityRef.current
      );

      const messages = filterAndConvertAssignmentChanges(
        changes,
        members,
        currentUserMemberIds
      );

      for (const message of messages) {
        upsertMessage(message);
      }
    },
    [upsertMessage]
  );

  return { onAssignmentChanges };
}
