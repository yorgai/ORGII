import { homeDir } from "@tauri-apps/api/path";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useAtomValue } from "jotai";
import { Copy, FileText, Folder, Globe } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Dropdown from "@src/components/Dropdown";
import { openUrlInBrowserApp } from "@src/components/MarkDown/markdownUtils";
import Menu from "@src/components/Menu";
import Message from "@src/components/Message";
import { currentRepoAtom } from "@src/store/repo";
import { workspaceFoldersAtom } from "@src/store/ui/workspaceFoldersAtom";
import { copyText } from "@src/util/data/clipboard";
import {
  SESSION_REFERENCE_FILE_MANAGER_REVEAL_KEYS,
  getFileManagerRevealLabelKey,
} from "@src/util/platform/fileManagerLabels";
import { openFileInEditor } from "@src/util/ui/openFileInEditor";

const WEB_URL_PATTERN = /https?:\/\/[^\s<>"'`\])}]+/gi;
const LOCAL_PATH_PATTERN =
  /(?:~\/|(?:\.\.\/|\.\/)|[A-Za-z]:[\\/]|\/(?:Users|home|Volumes|Applications|tmp|var|opt|usr|etc)\/|(?:documents|desktop|downloads|github|users)\/)[^\s<>"'`\])}]+/gi;
const TRAILING_REFERENCE_PUNCTUATION_PATTERN = /[.,;:!?]+$/;
const MAX_REFERENCE_CARDS = 4;
const PATH_SEGMENT_LABELS: Record<string, string> = {
  documents: "Documents",
  desktop: "Desktop",
  downloads: "Downloads",
  github: "GitHub",
  users: "Users",
};
const HOME_RELATIVE_ROOTS = new Set([
  "documents",
  "desktop",
  "downloads",
  "github",
]);

export type MessageReferenceKind = "web_url" | "local_path";

export interface MessageReferenceItem {
  kind: MessageReferenceKind;
  value: string;
  title: string;
  subtitle: string;
  isDirectory?: boolean;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeFsPath(path: string | undefined): string {
  if (!path) return "";
  const stripped = path.startsWith("file://")
    ? path.replace("file://", "")
    : path;
  return stripped.replace(/\/+$/, "");
}

function normalizeWorkspacePaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  return paths
    .map(normalizeFsPath)
    .filter((path) => path.length > 1)
    .filter((path) => {
      if (seen.has(path)) return false;
      seen.add(path);
      return true;
    })
    .sort((left, right) => right.length - left.length);
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

function normalizePathCandidate(candidate: string): string | null {
  const normalized = stripTrailingPunctuation(candidate);
  if (normalized.length < 2) return null;
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return null;
  }

  const segments = normalized.split("/");
  const firstSegment = segments[0]?.toLowerCase();
  const normalizedSegments = segments.map((segment) => {
    const label = PATH_SEGMENT_LABELS[segment.toLowerCase()];
    return label ?? segment;
  });
  if (firstSegment === "users") {
    return `/${normalizedSegments.join("/")}`;
  }
  if (firstSegment && HOME_RELATIVE_ROOTS.has(firstSegment)) {
    return `~/${normalizedSegments.join("/")}`;
  }

  return normalized;
}

async function resolveOpenPath(path: string): Promise<string> {
  if (!path.startsWith("~/")) return path;
  const home = await homeDir();
  return `${home.replace(/\/+$/, "")}/${path.slice(2)}`;
}

function getUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function getPathTitle(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const segments = trimmed.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function isDirectoryPath(path: string): boolean {
  if (path.endsWith("/")) return true;
  const title = getPathTitle(path);
  return !title.includes(".");
}

function collectWorkspacePathCandidates(
  content: string,
  workspacePaths: Array<string | undefined>
): string[] {
  const candidates: string[] = [];
  for (const workspacePath of normalizeWorkspacePaths(workspacePaths)) {
    const pattern = new RegExp(
      `${escapeRegExp(workspacePath)}(?:/[^\\s<>"'\`\\])}]+)?`,
      "g"
    );
    for (const match of content.matchAll(pattern)) {
      candidates.push(match[0]);
    }
  }
  return candidates;
}

function makeReferenceKey(item: MessageReferenceItem): string {
  return `${item.kind}:${item.value}`;
}

export function extractMessageReferences(
  content: string,
  workspacePaths: Array<string | undefined> = [],
  excludeUrls?: ReadonlySet<string>
): MessageReferenceItem[] {
  const searchableContent = stripFencedCodeBlocks(content);
  let pathSearchContent = searchableContent;
  const references: MessageReferenceItem[] = [];
  const seen = new Set<string>();

  for (const match of searchableContent.matchAll(WEB_URL_PATTERN)) {
    // Blank out the URL and any non-whitespace characters that directly
    // precede it in the same token (e.g. the "marketplace/" prefix before
    // "/users/me" in "marketplace/users/me"), preventing LOCAL_PATH_PATTERN
    // from matching URL sub-paths as local filesystem paths.
    const urlStart = match.index ?? 0;
    let tokenStart = urlStart;
    while (tokenStart > 0 && !/\s/.test(pathSearchContent[tokenStart - 1]!)) {
      tokenStart--;
    }
    const urlEnd = urlStart + match[0].length;
    let tokenEnd = urlEnd;
    while (
      tokenEnd < pathSearchContent.length &&
      !/\s/.test(pathSearchContent[tokenEnd]!)
    ) {
      tokenEnd++;
    }
    pathSearchContent =
      pathSearchContent.slice(0, tokenStart) +
      " ".repeat(tokenEnd - tokenStart) +
      pathSearchContent.slice(tokenEnd);
    const url = normalizeUrlCandidate(match[0]);
    if (!url) continue;
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

  for (const candidate of collectWorkspacePathCandidates(
    pathSearchContent,
    workspacePaths
  )) {
    const path = normalizePathCandidate(candidate);
    if (!path) continue;
    const item: MessageReferenceItem = {
      kind: "local_path",
      value: path,
      title: getPathTitle(path),
      subtitle: path,
      isDirectory: isDirectoryPath(path),
    };
    const key = makeReferenceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(item);
    if (references.length >= MAX_REFERENCE_CARDS) return references;
  }

  for (const match of pathSearchContent.matchAll(LOCAL_PATH_PATTERN)) {
    const path = normalizePathCandidate(match[0]);
    if (!path) continue;
    const item: MessageReferenceItem = {
      kind: "local_path",
      value: path,
      title: getPathTitle(path),
      subtitle: path,
      isDirectory: isDirectoryPath(path),
    };
    const key = makeReferenceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(item);
    if (references.length >= MAX_REFERENCE_CARDS) return references;
  }

  return references;
}

interface MessageReferenceCardProps {
  item: MessageReferenceItem;
}

const MessageReferenceCard: React.FC<MessageReferenceCardProps> = ({
  item,
}) => {
  const { t } = useTranslation("sessions");
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const copyLabel =
    item.kind === "web_url" ? t("cards.url.copyUrl") : t("cards.path.copyPath");
  const copiedLabel =
    item.kind === "web_url" ? t("cards.url.copied") : t("cards.path.copied");
  const openLabel =
    item.kind === "web_url" ? t("cards.url.open") : t("cards.path.open");
  const openInAppLabel = t("cards.actions.openInApp");
  const externalOpenLabel =
    item.kind === "web_url"
      ? t("cards.actions.openWithDefaultBrowser")
      : t(
          getFileManagerRevealLabelKey(
            SESSION_REFERENCE_FILE_MANAGER_REVEAL_KEYS
          )
        );

  const handleOpen = useCallback(() => {
    setDropdownVisible(false);
    if (item.kind === "web_url") {
      openUrlInBrowserApp(item.value, { navigate: true });
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
    if (item.kind === "web_url") {
      void openUrl(item.value).catch(() => {
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
      await copyText(item.value);
      Message.success(copiedLabel);
    } catch {
      Message.error(t("failedToCopyContent"));
    }
  }, [copiedLabel, item.value, t]);

  const Icon =
    item.kind === "web_url" ? Globe : item.isDirectory ? Folder : FileText;

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border-2 bg-bg-2 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-1 text-primary-6">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-text-1">
          {item.title}
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
          aria-label={copyLabel}
          title={copyLabel}
          onClick={handleCopy}
        />
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
      </div>
    </div>
  );
};

interface MessageReferenceCardsProps {
  content: string;
  enabled?: boolean;
  items?: MessageReferenceItem[];
  excludeUrls?: ReadonlySet<string>;
}

const MessageReferenceCards: React.FC<MessageReferenceCardsProps> = ({
  content,
  enabled = true,
  items,
  excludeUrls,
}) => {
  const currentRepo = useAtomValue(currentRepoAtom);
  const workspaceFolders = useAtomValue(workspaceFoldersAtom);
  const workspaceReferencePaths = useMemo(
    () => [
      ...workspaceFolders.map((folder) => folder.path),
      currentRepo?.path,
      currentRepo?.fs_uri,
    ],
    [currentRepo?.fs_uri, currentRepo?.path, workspaceFolders]
  );
  const references = useMemo(
    () =>
      items ??
      (enabled
        ? extractMessageReferences(
            content,
            workspaceReferencePaths,
            excludeUrls
          )
        : []),
    [content, enabled, excludeUrls, items, workspaceReferencePaths]
  );

  if (references.length === 0) return null;

  return (
    <div className="mt-3 flex w-full flex-col gap-2">
      {references.map((item) => (
        <MessageReferenceCard key={makeReferenceKey(item)} item={item} />
      ))}
    </div>
  );
};

MessageReferenceCards.displayName = "MessageReferenceCards";

export default MessageReferenceCards;
