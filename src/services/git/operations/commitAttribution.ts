import {
  gitCoauthorAttributionEnabledAtom,
  gitPrAttributionEnabledAtom,
} from "@src/store/ui/editorSettingsAtom";
import {
  getInstrumentedStore,
  isStoreInitialized,
} from "@src/util/core/state/instrumentedStore";

export const ORGII_COAUTHOR_NAME = "ORGII";
export const ORGII_COAUTHOR_GITHUB_ACCOUNT = "ORGII-agent";
export const ORGII_COAUTHOR_EMAIL = `${ORGII_COAUTHOR_GITHUB_ACCOUNT}@users.noreply.github.com`;

const ORGII_COAUTHOR_TRAILER = `Co-authored-by: ${ORGII_COAUTHOR_NAME} <${ORGII_COAUTHOR_EMAIL}>`;
const ORGII_PR_ATTRIBUTION_FOOTER = `Created with ${ORGII_COAUTHOR_NAME}\n\n${ORGII_COAUTHOR_TRAILER}`;

export function shouldIncludeGitCoauthor(): boolean {
  if (!isStoreInitialized()) return true;
  return getInstrumentedStore().get(gitCoauthorAttributionEnabledAtom);
}

export function shouldIncludePullRequestAttribution(): boolean {
  if (!isStoreInitialized()) return true;
  return getInstrumentedStore().get(gitPrAttributionEnabledAtom);
}

export function appendGitCoauthorTrailer(message: string): string {
  if (!shouldIncludeGitCoauthor()) return message;

  const hasTrailer = message
    .split("\n")
    .some((line) => line.trim() === ORGII_COAUTHOR_TRAILER);

  if (hasTrailer) return message;

  const trimmedMessage = message.trimEnd();
  if (!trimmedMessage) return message;

  return `${trimmedMessage}\n\n${ORGII_COAUTHOR_TRAILER}`;
}

export function appendPullRequestAttributionFooter(
  body?: string | null
): string {
  const normalizedBody = body?.trimEnd() ?? "";
  if (!shouldIncludePullRequestAttribution()) return normalizedBody;

  if (normalizedBody.includes(ORGII_COAUTHOR_TRAILER)) return normalizedBody;
  if (!normalizedBody) return ORGII_PR_ATTRIBUTION_FOOTER;

  return `${normalizedBody}\n\n---\n\n${ORGII_PR_ATTRIBUTION_FOOTER}`;
}
