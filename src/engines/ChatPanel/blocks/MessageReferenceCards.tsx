import { homeDir } from "@tauri-apps/api/path";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ArrowRight,
  Copy,
  FileText,
  Folder,
  GitCommitHorizontal,
  Globe,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getGitCommits } from "@src/api/http/git";
import type { GitCommitInfo } from "@src/api/http/git/types";
import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { openUrlInBrowserApp } from "@src/components/MarkDown/markdownUtils";
import Menu from "@src/components/Menu";
import Message from "@src/components/Message";
import { resolveAgentIcon } from "@src/config/agentIcons";
import { replayModeAtom } from "@src/engines/SessionCore";
import { AppType } from "@src/engines/Simulator/types/appTypes";
import { useSessionView } from "@src/hooks/ui/tabs/useSessionView";
import { parseGitArtifactsFromText } from "@src/shared/git/sessionGitArtifacts";
import { sessionByIdAtom } from "@src/store/session";
import { chatPanelMaximizedAtom } from "@src/store/ui/chatPanelAtom";
import {
  simulatorDiffCommitNavigationRequestAtom,
  simulatorSelectedAppAtom,
  stationModeAtom,
} from "@src/store/ui/simulatorAtom";
import { activeWorkspaceRootPathAtom } from "@src/store/workspace";
import { copyText } from "@src/util/data/clipboard";
import {
  SESSION_REFERENCE_FILE_MANAGER_REVEAL_KEYS,
  getFileManagerRevealLabelKey,
} from "@src/util/platform/fileManagerLabels";
import {
  createSessionIdTextPattern,
  resolveSessionIconId,
} from "@src/util/session/sessionDispatch";
import { formatRelativeTime } from "@src/util/time/formatRelativeTime";
import { openFileInEditor } from "@src/util/ui/openFileInEditor";

const WEB_URL_PATTERN = /https?:\/\/[^\s<>"'`\])}]+/gi;
const TRAILING_REFERENCE_PUNCTUATION_PATTERN = /[.,;:!?]+$/;
const MAX_REFERENCE_CARDS = 4;
const COMMIT_METADATA_LOOKUP_LIMIT = 200;

export type MessageReferenceKind =
  | "web_url"
  | "local_path"
  | "git_commit"
  | "session";

export interface MessageReferenceItem {
  kind: MessageReferenceKind;
  value: string;
  title: string;
  subtitle: string;
  isDirectory?: boolean;
  url?: string;
  sha?: string;
  shortSha?: string;
  authorName?: string;
  authorDate?: string;
  /** Full session id for `kind === "session"` cards. */
  sessionId?: string;
}

function stripFencedCodeBlocks(content: string): string {
  const lines = content.split("\n");
  let insideFence = false;
  return lines
    .map((line) => {
      if (line.trimStart().startsWith("```")) {
        insideFence = !insideFence;
        return "";
      }
      return insideFence ? "" : line;
    })
    .join("\n");
}

function stripTrailingPunctuation(candidate: string): string {
  return candidate.replace(TRAILING_REFERENCE_PUNCTUATION_PATTERN, "");
}

/**
 * Returns true when a URL regex match is enclosed in bare parentheses and
 * is likely being *cited* rather than recommended for the user to open.
 *
 * Heuristic: the character before the URL is `(` AND the character after
 * is `)`, BUT it is NOT a Markdown hyperlink — those have `](` before the
 * URL (e.g. `[label](https://...)`), which we want to keep as a reference.
 */
function isUrlCitedInParentheses(
  content: string,
  matchIndex: number,
  matchLength: number
): boolean {
  const before = content[matchIndex - 1];
  const twoCharsBefore = content.slice(Math.max(0, matchIndex - 2), matchIndex);
  const after = content[matchIndex + matchLength];
  // Skip: bare parentheses around URL, but NOT Markdown link syntax ](
  return (
    before === "(" &&
    twoCharsBefore !== "](" &&
    (after === ")" || after === ")")
  );
}

function normalizeUrlCandidate(candidate: string): string | null {
  const normalized = stripTrailingPunctuation(candidate);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Lexically collapses `.` and `..` segments out of `path`. Pure string
 * transform — no filesystem IO and no symlink resolution, which matches
 * what we want here: we never want to chase a symlink just to render a
 * chat-message file card.
 *
 * Tauri's plugin-fs scope checker rejects any path containing a `..`
 * component outright with `cannot traverse directory, rewrite the path
 * without the use of '../'`, even when the resolved path still falls
 * inside the allowed scope. Chat messages routinely include relative
 * forms like `/Users/me/proj/../sibling/file.ts` (typed by the user or
 * synthesised by the assistant), so we collapse those segments before
 * handing the path to any file operation.
 *
 * Behaviour:
 *   - `/A/B/../C`           → `/A/C`
 *   - `/A/./B`              → `/A/B`
 *   - `/A/B/..`             → `/A`
 *   - `/..`                 → `/`        (cannot escape filesystem root)
 *   - `A/B/../../../C`      → `../C`     (relative roots may still go up)
 *   - empty / no segments   → returned unchanged
 *
 * Trailing slashes are preserved when present so directory paths keep
 * their visual cue.
 */
export function collapseRelativePathSegments(path: string): string {
  if (
    !path ||
    (!path.includes("/./") &&
      !path.includes("/../") &&
      !path.endsWith("/.") &&
      !path.endsWith("/.."))
  ) {
    return path;
  }

  const isAbsolute = path.startsWith("/");
  const hasTrailingSlash = path.length > 1 && path.endsWith("/");
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const stack: string[] = [];

  for (const segment of segments) {
    if (segment === ".") continue;
    if (segment === "..") {
      // Absolute paths can never escape the filesystem root. Relative
      // paths preserve leading `..` segments so things like `../sibling`
      // still resolve relative to their caller.
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push("..");
      }
      continue;
    }
    stack.push(segment);
  }

  const joined = stack.join("/");
  if (isAbsolute) {
    const body = joined.length > 0 ? `/${joined}` : "/";
    return hasTrailingSlash && body !== "/" ? `${body}/` : body;
  }
  if (joined.length === 0) return ".";
  return hasTrailingSlash ? `${joined}/` : joined;
}

export async function resolveOpenPath(path: string): Promise<string> {
  if (!path.startsWith("~/")) return collapseRelativePathSegments(path);
  const home = await homeDir();
  const expanded = `${home.replace(/\/+$/, "")}/${path.slice(2)}`;
  return collapseRelativePathSegments(expanded);
}

function getUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isGitHubCommitUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "github.com" &&
      /\/[^/]+\/[^/]+\/commit\/[0-9a-f]{7,40}$/i.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function makeCommitReferenceItem(artifact: {
  sha?: string;
  shortSha?: string;
  subject?: string;
  repoFullName?: string;
  url?: string;
}): MessageReferenceItem | null {
  const sha = artifact.sha?.trim().toLowerCase();
  const shortSha = artifact.shortSha ?? sha?.slice(0, 7);
  if (!sha && !shortSha) return null;
  const label = shortSha ?? sha ?? "";
  return {
    kind: "git_commit",
    value: sha ?? label,
    title: artifact.subject || `Commit ${label}`,
    subtitle: artifact.repoFullName
      ? `${label} · ${artifact.repoFullName}`
      : label,
    url: artifact.url,
    sha,
    shortSha: label,
  };
}

function commitMatchesReference(
  commit: GitCommitInfo,
  item: MessageReferenceItem
): boolean {
  if (item.kind !== "git_commit" || !item.sha) return false;
  const itemSha = item.sha.toLowerCase();
  const commitSha = commit.sha.toLowerCase();
  return commitSha.startsWith(itemSha) || itemSha.startsWith(commitSha);
}

function mergeCommitMetadata(
  item: MessageReferenceItem,
  commit: GitCommitInfo
): MessageReferenceItem {
  if (item.kind !== "git_commit") return item;
  const shortSha = commit.short_sha || item.shortSha || item.sha;
  const authorName = commit.author?.name;
  const authorDate = commit.author?.date;
  const metaParts = [
    shortSha,
    authorName,
    authorDate ? formatRelativeTime(authorDate, "nano") : undefined,
  ].filter(Boolean);
  return {
    ...item,
    value: commit.sha,
    title: commit.summary || item.title,
    subtitle: metaParts.join(" · "),
    sha: commit.sha,
    shortSha,
    authorName,
    authorDate,
  };
}

function makeReferenceKey(item: MessageReferenceItem): string {
  if (item.kind === "git_commit") {
    return `git_commit:${item.sha ?? item.shortSha ?? item.value}`;
  }
  return `${item.kind}:${item.value}`;
}

/**
 * Compact session-id label for the card subtitle: prefix + first UUID
 * segment (`sdeagent-ee970f47…`). The full id stays in `value` for copy.
 */
function shortSessionIdLabel(sessionId: string): string {
  const uuidStart = sessionId.search(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
  );
  if (uuidStart <= 0) return sessionId;
  return `${sessionId.slice(0, uuidStart)}${sessionId.slice(uuidStart, uuidStart + 8)}…`;
}

export function extractMessageReferences(
  content: string,
  excludeUrls?: ReadonlySet<string>
): MessageReferenceItem[] {
  const searchableContent = stripFencedCodeBlocks(content);
  const references: MessageReferenceItem[] = [];
  const seen = new Set<string>();

  // Session ids first: they win over commit/path extraction for the same
  // text span. `parseGitArtifactsFromText` masks session ids internally,
  // and we blank them out of the path-search content below so the path
  // pass cannot partially match inside them either.
  for (const match of searchableContent.matchAll(
    createSessionIdTextPattern()
  )) {
    const sessionId = match[0];
    const item: MessageReferenceItem = {
      kind: "session",
      value: sessionId,
      title: shortSessionIdLabel(sessionId),
      subtitle: sessionId,
      sessionId,
    };
    const key = makeReferenceKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      references.push(item);
    }
    if (references.length >= MAX_REFERENCE_CARDS) return references;
  }

  for (const artifact of parseGitArtifactsFromText(searchableContent)) {
    if (artifact.kind !== "commit") continue;
    const item = makeCommitReferenceItem(artifact);
    if (!item) continue;
    const key = makeReferenceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(item);
    if (references.length >= MAX_REFERENCE_CARDS) return references;
  }

  for (const match of searchableContent.matchAll(WEB_URL_PATTERN)) {
    const url = normalizeUrlCandidate(match[0]);
    if (!url) continue;
    if (isGitHubCommitUrl(url)) continue;
    if (excludeUrls?.has(url)) continue;
    if (
      isUrlCitedInParentheses(
        searchableContent,
        match.index ?? 0,
        match[0].length
      )
    )
      continue;
    const item: MessageReferenceItem = {
      kind: "web_url",
      value: url,
      title: getUrlHost(url),
      subtitle: url,
    };
    const key = makeReferenceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(item);
    if (references.length >= MAX_REFERENCE_CARDS) return references;
  }

  return references;
}

function useCommitMetadataReferences(
  references: MessageReferenceItem[],
  repoPath: string | undefined
): MessageReferenceItem[] {
  const [metadataState, setMetadataState] = useState<{
    repoPath: string;
    commits: GitCommitInfo[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const commitReferences = references.filter(
      (item) => item.kind === "git_commit" && item.sha
    );
    if (!repoPath || commitReferences.length === 0) return;

    async function loadCommitMetadata() {
      const result = await getGitCommits({
        repo_id: repoPath ?? "",
        repo_path: repoPath,
        limit: COMMIT_METADATA_LOOKUP_LIMIT,
      });
      if (cancelled || !result?.commits?.length || !repoPath) return;
      setMetadataState({ repoPath, commits: result.commits });
    }

    void loadCommitMetadata();

    return () => {
      cancelled = true;
    };
  }, [references, repoPath]);

  return useMemo(() => {
    if (!metadataState || metadataState.repoPath !== repoPath)
      return references;
    return references.map((item) => {
      if (item.kind !== "git_commit") return item;
      const commit = metadataState.commits.find((candidate) =>
        commitMatchesReference(candidate, item)
      );
      return commit ? mergeCommitMetadata(item, commit) : item;
    });
  }, [metadataState, references, repoPath]);
}

interface MessageReferenceCardProps {
  item: MessageReferenceItem;
  sessionId?: string | null;
  compact?: boolean;
}

/**
 * Reference card for a session id mentioned in chat ("look at session
 * sdeagent-…"). Title shows the live session name when the session is
 * known to the store; the primary action jumps the WorkStation to it.
 */
const SessionReferenceCard: React.FC<{ item: MessageReferenceItem }> = ({
  item,
}) => {
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const referencedSessionId = item.sessionId ?? item.value;
  const referencedSession = useAtomValue(sessionByIdAtom(referencedSessionId));
  const { openSession } = useSessionView();

  const handleJump = useCallback(() => {
    openSession(
      referencedSessionId,
      referencedSession?.name,
      referencedSession?.repoPath ?? undefined
    );
  }, [openSession, referencedSession, referencedSessionId]);

  const handleCopy = useCallback(async () => {
    try {
      await copyText(referencedSessionId);
      Message.success(tCommon("copied"));
    } catch {
      Message.error(t("failedToCopyContent"));
    }
  }, [referencedSessionId, t, tCommon]);

  const sessionIcon = React.createElement(
    resolveAgentIcon(resolveSessionIconId(referencedSessionId)),
    { size: 18 }
  );
  const title = referencedSession?.name || item.title;

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border-2 bg-bg-2 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-1 text-primary-6">
        {sessionIcon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-text-1">
          {title}
        </div>
        <div className="truncate text-[12px] text-text-3">{item.subtitle}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          appearance="ghost"
          size="small"
          icon={<Copy size={14} />}
          iconOnly
          aria-label={tCommon("actions.copy")}
          title={tCommon("actions.copy")}
          onClick={handleCopy}
        />
        <Button variant="primary" size="small" onClick={handleJump}>
          {t("cards.session.open")}
        </Button>
      </div>
    </div>
  );
};
SessionReferenceCard.displayName = "SessionReferenceCard";

const MessageReferenceCard: React.FC<MessageReferenceCardProps> = ({
  item,
  sessionId,
  compact = false,
}) => {
  const { t } = useTranslation("sessions");
  const { t: tCommon } = useTranslation("common");
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const setChatPanelMaximized = useSetAtom(chatPanelMaximizedAtom);
  const setStationMode = useSetAtom(stationModeAtom);
  const setSelectedSimulatorApp = useSetAtom(simulatorSelectedAppAtom);
  const setReplayMode = useSetAtom(replayModeAtom);
  const setDiffCommitNavigationRequest = useSetAtom(
    simulatorDiffCommitNavigationRequestAtom
  );
  const isCommit = item.kind === "git_commit";
  const isUrl = item.kind === "web_url";
  const isLocalPath = item.kind === "local_path";
  const isOpenable = isUrl || isLocalPath || Boolean(item.url);
  const copyLabel = isUrl
    ? t("cards.url.copyUrl")
    : isLocalPath
      ? t("cards.path.copyPath")
      : isCommit
        ? tCommon("git.commit.copySha")
        : tCommon("actions.copy");
  const copiedLabel = isUrl
    ? t("cards.url.copied")
    : isLocalPath
      ? t("cards.path.copied")
      : isCommit
        ? tCommon("git.commit.shaCopied")
        : tCommon("copied");
  const openLabel = isLocalPath ? t("cards.path.open") : t("cards.url.open");
  const openInAppLabel = t("cards.actions.openInApp");
  const externalOpenLabel =
    isUrl || isCommit
      ? t("cards.actions.openWithDefaultBrowser")
      : t(
          getFileManagerRevealLabelKey(
            SESSION_REFERENCE_FILE_MANAGER_REVEAL_KEYS
          )
        );

  const handleOpen = useCallback(() => {
    setDropdownVisible(false);
    if (item.kind === "web_url" || item.url) {
      openUrlInBrowserApp(item.url ?? item.value, { navigate: true });
      return;
    }

    void resolveOpenPath(item.value)
      .then((path) => {
        openFileInEditor(path, { isDirectory: item.isDirectory ?? false });
        return undefined;
      })
      .catch(() => {
        Message.error(t("cards.path.openFailed"));
      });
  }, [item, t]);

  const handleExternalOpen = useCallback(() => {
    setDropdownVisible(false);
    if (item.kind === "web_url" || item.url) {
      void openUrl(item.url ?? item.value).catch(() => {
        Message.error(t("cards.url.openExternalFailed"));
      });
      return;
    }

    void resolveOpenPath(item.value)
      .then((path) => revealItemInDir(path))
      .catch(() => {
        Message.error(t("cards.path.revealFailed"));
      });
  }, [item, t]);

  const handleCopy = useCallback(async () => {
    try {
      await copyText(item.sha ?? item.value);
      Message.success(copiedLabel);
    } catch {
      Message.error(t("failedToCopyContent"));
    }
  }, [copiedLabel, item.sha, item.value, t]);

  const handleOpenCommitInDiff = useCallback(() => {
    const commitSha = item.sha ?? item.value;
    if (!commitSha) return;
    setChatPanelMaximized(false);
    setStationMode("agent-station");
    setSelectedSimulatorApp(AppType.DIFF);
    setReplayMode("replay");
    setDiffCommitNavigationRequest({
      sessionId,
      commitSha,
      nonce: Date.now(),
    });
  }, [
    item.sha,
    item.value,
    sessionId,
    setChatPanelMaximized,
    setDiffCommitNavigationRequest,
    setReplayMode,
    setSelectedSimulatorApp,
    setStationMode,
  ]);

  const Icon = isUrl
    ? Globe
    : isCommit
      ? GitCommitHorizontal
      : item.isDirectory
        ? Folder
        : FileText;

  return (
    <div
      className={
        compact
          ? "flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-fill-2"
          : "flex min-w-0 items-center gap-3 rounded-xl border border-border-2 bg-bg-2 p-3"
      }
    >
      <div
        className={
          compact
            ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-1 text-primary-6"
            : "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-1 text-primary-6"
        }
      >
        <Icon size={compact ? 15 : 18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="chat-block-content truncate text-[13px] font-medium text-text-1">
          {item.title}
        </div>
        <div className="chat-block-content truncate text-[12px] text-text-3">
          {item.subtitle}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          appearance="ghost"
          size="small"
          icon={<Copy size={14} />}
          iconOnly
          aria-label={copyLabel}
          title={copyLabel}
          onClick={handleCopy}
        />
        {isCommit && (
          <Button
            variant="secondary"
            appearance="ghost"
            size="small"
            icon={<ArrowRight size={14} />}
            iconOnly
            aria-label={tCommon("actions.open")}
            title={tCommon("actions.open")}
            onClick={handleOpenCommitInDiff}
          />
        )}
        {isOpenable && (
          <Button
            variant="primary"
            size="small"
            onClick={handleOpen}
            dropdownMenu={
              <Dropdown
                droplist={
                  <Menu>
                    <Menu.Item key="open-in-app" onClick={handleOpen}>
                      {openInAppLabel}
                    </Menu.Item>
                    <Menu.Item key="external-open" onClick={handleExternalOpen}>
                      {externalOpenLabel}
                    </Menu.Item>
                  </Menu>
                }
                trigger="click"
                position="bottom-end"
                popupVisible={dropdownVisible}
                onVisibleChange={setDropdownVisible}
                getPopupContainer={() => document.body}
                avoidViewportOverflow
                className="z-[9999]"
                style={{ zIndex: 9999 }}
              >
                <div />
              </Dropdown>
            }
            onDropdownClick={(event) => {
              event.stopPropagation();
              setDropdownVisible(!dropdownVisible);
            }}
            dropdownVisible={dropdownVisible}
            splitWidthMode="hug"
          >
            {openLabel}
          </Button>
        )}
      </div>
    </div>
  );
};

const UrlReferenceGroupCard: React.FC<{
  items: MessageReferenceItem[];
  sessionId?: string | null;
}> = ({ items, sessionId }) => {
  const { t } = useTranslation("sessions");

  return (
    <div className="rounded-xl border border-border-2 bg-bg-2 p-2">
      <div className="chat-block-content px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-3">
        {t("cards.url.groupTitle", {
          count: items.length,
          defaultValue: "Web pages",
        })}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <MessageReferenceCard
            key={makeReferenceKey(item)}
            item={item}
            sessionId={sessionId}
            compact
          />
        ))}
      </div>
    </div>
  );
};

interface MessageReferenceCardsProps {
  content: string;
  enabled?: boolean;
  items?: MessageReferenceItem[];
  excludeUrls?: ReadonlySet<string>;
  sessionId?: string | null;
}

const MessageReferenceCards: React.FC<MessageReferenceCardsProps> = ({
  content,
  enabled = true,
  items,
  excludeUrls,
  sessionId,
}) => {
  const activeWorkspaceRootPath = useAtomValue(activeWorkspaceRootPathAtom);
  const session = useAtomValue(sessionByIdAtom(sessionId ?? ""));
  const references = useMemo(
    () =>
      items ?? (enabled ? extractMessageReferences(content, excludeUrls) : []),
    [content, enabled, excludeUrls, items]
  );
  const metadataRepoPath = session?.repoPath || activeWorkspaceRootPath;
  const resolvedReferences = useCommitMetadataReferences(
    references,
    metadataRepoPath
  );

  if (resolvedReferences.length === 0) return null;

  const urlReferences = resolvedReferences.filter(
    (item) => item.kind === "web_url"
  );
  const groupedUrlReferences = urlReferences.length > 1;
  const renderedReferences = groupedUrlReferences
    ? resolvedReferences.filter((item) => item.kind !== "web_url")
    : resolvedReferences;

  return (
    <div className="mt-3 flex w-full flex-col gap-2">
      {renderedReferences.map((item) =>
        item.kind === "session" ? (
          <SessionReferenceCard key={makeReferenceKey(item)} item={item} />
        ) : (
          <MessageReferenceCard
            key={makeReferenceKey(item)}
            item={item}
            sessionId={sessionId}
          />
        )
      )}
      {groupedUrlReferences && (
        <UrlReferenceGroupCard items={urlReferences} sessionId={sessionId} />
      )}
    </div>
  );
};

MessageReferenceCards.displayName = "MessageReferenceCards";

export default MessageReferenceCards;
