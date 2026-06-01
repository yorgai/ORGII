/**
 * useCurrentUserMemberId
 *
 * Resolves the current user's project member ID(s) by matching against
 * all known user identities:
 * - Local git config user.email (from Tauri command — most reliable)
 * - Local git config user.name (fallback)
 * - userAtom.git_user_email (if populated)
 * - github_infos / gitlab_infos usernames (matched against email prefix)
 *
 * A single person often has multiple member entries (from git shortlog)
 * because they commit with different emails. This hook returns ALL
 * matching member IDs so assignment notifications work regardless of
 * which member entry was used.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";

import type { MemberEntry } from "@src/api/http/project";
import { userAtom } from "@src/store/user/userAtom";
import type { IUserInfo } from "@src/types/core/user";

// ============================================
// Git identity from Tauri
// ============================================

interface GitUserIdentity {
  email: string | null;
  name: string | null;
  /** GitHub username from gh CLI config (~/.config/gh/hosts.yml) */
  github_username: string | null;
}

/** Cached git identity to avoid repeated Tauri calls */
let cachedGitIdentity: GitUserIdentity | null = null;
let identityPromise: Promise<GitUserIdentity> | null = null;

async function fetchGitIdentity(repoPath?: string): Promise<GitUserIdentity> {
  if (cachedGitIdentity) return cachedGitIdentity;
  if (identityPromise) return identityPromise;

  identityPromise = invoke<GitUserIdentity>("get_git_user_identity", {
    repoPath: repoPath ?? null,
  })
    .then((result) => {
      cachedGitIdentity = result;
      return result;
    })
    .catch(() => {
      const fallback: GitUserIdentity = {
        email: null,
        name: null,
        github_username: null,
      };
      cachedGitIdentity = fallback;
      return fallback;
    });

  return identityPromise;
}

/** Reset cached identity (e.g. when repo changes) */
export function resetGitIdentityCache() {
  cachedGitIdentity = null;
  identityPromise = null;
}

// ============================================
// Identity collection
// ============================================

interface UserIdentities {
  emails: string[];
  userName: string;
}

/**
 * Collect all emails/usernames the current user might be known by.
 */
function collectIdentities(
  user: IUserInfo,
  gitIdentity: GitUserIdentity | null
): UserIdentities {
  const emailSet = new Set<string>();

  // 1. GitHub username from gh CLI (most reliable for matching)
  if (gitIdentity?.github_username) {
    emailSet.add(gitIdentity.github_username.toLowerCase().trim());
  }

  // 2. Local git config email (matches git shortlog entries)
  if (gitIdentity?.email) {
    emailSet.add(gitIdentity.email.toLowerCase().trim());
  }

  // 3. userAtom git_user_email (if populated by backend)
  if (user.git_user_email) {
    emailSet.add(user.git_user_email.toLowerCase().trim());
  }

  // 4. GitHub usernames from linked accounts
  for (const gh of user.github_infos ?? []) {
    if (gh.user_name) {
      emailSet.add(gh.user_name.toLowerCase().trim());
    }
  }

  // 5. GitLab usernames
  for (const gl of user.gitlab_infos ?? []) {
    if (gl.user_name) {
      emailSet.add(gl.user_name.toLowerCase().trim());
    }
  }

  // Best user name: prefer git config, then userAtom
  const userName = (gitIdentity?.name || user.git_user_name || "")
    .toLowerCase()
    .trim();

  return { emails: [...emailSet], userName };
}

// ============================================
// Member matching
// ============================================

/**
 * Check if a member entry matches any of the user's known identities.
 */
function memberMatchesUser(
  member: MemberEntry,
  identities: UserIdentities
): boolean {
  const memberEmail = (member.email || "").toLowerCase().trim();
  const memberName = (member.name || "").toLowerCase().trim();

  for (const email of identities.emails) {
    // Direct email match
    if (memberEmail === email) return true;

    // Email prefix match (e.g. github username "leeyyi" matches "leeyyi@vip.qq.com")
    if (memberEmail && memberEmail.split("@")[0] === email) return true;

    // Reverse: member email prefix matches user email
    if (
      email.includes("@") &&
      email.split("@")[0] === memberEmail.split("@")[0]
    ) {
      return true;
    }
  }

  // Name-based fallback
  if (identities.userName && memberName === identities.userName) return true;

  return false;
}

/**
 * Find a member entry by exact email match.
 */
export function findMemberByEmail(
  members: MemberEntry[],
  email: string
): MemberEntry | undefined {
  const normalized = email.toLowerCase().trim();
  return members.find(
    (member) => (member.email || "").toLowerCase().trim() === normalized
  );
}

// ============================================
// Public API
// ============================================

/**
 * Find ALL member IDs that belong to the current user.
 * Returns a Set for O(1) lookup.
 *
 * This is the synchronous version — uses whatever identity data is available.
 * For the async version that fetches git config, use the hook.
 */
export function findMemberIdsByUser(
  members: MemberEntry[],
  user: IUserInfo,
  gitIdentity?: GitUserIdentity | null
): Set<string> {
  const identities = collectIdentities(user, gitIdentity ?? cachedGitIdentity);
  const ids = new Set<string>();

  for (const member of members) {
    if (memberMatchesUser(member, identities)) {
      ids.add(member.id);
    }
  }

  return ids;
}

// ============================================
// Hook
// ============================================

interface UseCurrentUserMemberIdsReturn {
  /** Set of member IDs belonging to the current user */
  memberIds: Set<string>;
  /** Current user's git email (primary) */
  gitEmail: string;
}

/**
 * Hook that provides all member IDs belonging to the current user.
 * Fetches git identity from local config on mount.
 */
export function useCurrentUserMemberIds(
  members: MemberEntry[]
): UseCurrentUserMemberIdsReturn {
  const user = useAtomValue(userAtom);
  const [gitIdentity, setGitIdentity] = useState<GitUserIdentity | null>(
    cachedGitIdentity
  );
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current && cachedGitIdentity) return;
    let cancelled = false;

    fetchGitIdentity().then((identity) => {
      if (!cancelled) {
        setGitIdentity(identity);
        fetchedRef.current = true;
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const memberIds = useMemo(
    () => findMemberIdsByUser(members, user, gitIdentity),
    [members, user, gitIdentity]
  );

  const gitEmail = gitIdentity?.email || user.git_user_email || "";

  return { memberIds, gitEmail };
}
