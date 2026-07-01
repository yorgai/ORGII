import { useAtom, useSetAtom } from "jotai";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { projectApi } from "@src/api/http/project";
import type { ProjectOrg } from "@src/api/http/project";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import Markdown from "@src/components/MarkDown";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import {
  CollapsibleSection,
  PANEL_FOOTER_TOKENS,
} from "@src/modules/shared/layouts/blocks";
import SelectionGrid from "@src/scaffold/WizardSystem/primitives/SelectionGrid";
import type { SelectionGridOption } from "@src/scaffold/WizardSystem/primitives/SelectionGrid";
import {
  collabInvitesAtom,
  collabMembersAtom,
  collabOrgsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import { collabPendingInviteAtom } from "@src/store/collaboration/collabPendingInviteAtom";
import { parseCollabInviteInput } from "@src/store/collaboration/protocol";
import { COLLAB_IDENTITY_KIND } from "@src/store/collaboration/types";
import type {
  CollabIdentityKind,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgRecord,
} from "@src/store/collaboration/types";
import { copyText } from "@src/util/data/clipboard";

import { ORGII_SUPABASE_SETUP_SQL } from "../../sync/supabaseSetupSql";
import { supabaseSyncClient } from "../../sync/supabaseSyncClient";

const LOCAL_SOURCE = "local";
const SUPABASE_SOURCE = "supabase";
const CREATE_MODE = "create";
const JOIN_MODE = "join";
const DEFAULT_INVITE_USAGE_LIMIT = 10;

const SUPABASE_SETUP_MARKDOWN = `1. Create a Supabase project in the Supabase dashboard.

2. Copy the Project URL and anon public key into ORGII.

3. Click **Copy setup SQL** below.

4. Open the Supabase SQL Editor, paste the SQL, and click **Run**.

5. Return to ORGII and click **Verify setup**.

No terminal commands are required. ORGII stores project, work item, chat, and shared session data in your own Supabase project.`;

const SUPABASE_SQL_EDITOR_URL =
  "https://supabase.com/dashboard/project/_/sql/new";

const COLLAB_FORM_CONTROL_STYLE = {
  width: "100%",
  maxWidth: "100%",
} as const;

type CreateOrgSource = typeof LOCAL_SOURCE | typeof SUPABASE_SOURCE;
type CreateCollabOrgMode = typeof CREATE_MODE | typeof JOIN_MODE;

type SetupVerificationStatus = "idle" | "ok" | "missing";

export type CreatedOrgResult =
  | {
      source: typeof LOCAL_SOURCE;
      org: ProjectOrg;
    }
  | {
      source: typeof SUPABASE_SOURCE;
      org: CollabOrgRecord;
      member: CollabMemberRecord;
    };

export interface CreateCollabOrgViewProps {
  onCancel: () => void;
  onCreated?: (result: CreatedOrgResult) => void;
}

function upsertOrg(
  current: CollabOrgRecord[],
  org: CollabOrgRecord
): CollabOrgRecord[] {
  const existingIndex = current.findIndex((item) => item.id === org.id);
  if (existingIndex < 0) return [org, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...org };
  return next;
}

function upsertMember(
  current: CollabMemberRecord[],
  member: CollabMemberRecord
): CollabMemberRecord[] {
  const existingIndex = current.findIndex((item) => item.id === member.id);
  if (existingIndex < 0) return [member, ...current];
  const next = [...current];
  next[existingIndex] = { ...current[existingIndex], ...member };
  return next;
}

function upsertInvite(
  current: CollabInviteRecord[],
  invite: CollabInviteRecord
): CollabInviteRecord[] {
  const existingIndex = current.findIndex((item) => item.id === invite.id);
  if (existingIndex < 0) return [invite, ...current];
  const next = [...current];
  next[existingIndex] = invite;
  return next;
}

async function ensureProjectOrgForCollabOrg(
  org: CollabOrgRecord
): Promise<ProjectOrg> {
  const projectOrgs = await projectApi.readOrgs();
  const existingOrg = projectOrgs.find(
    (projectOrg) => projectOrg.id === org.id
  );
  if (existingOrg) return existingOrg;

  const existingByName = projectOrgs.find(
    (projectOrg) => projectOrg.name === org.name
  );
  if (existingByName) return existingByName;

  return projectApi.createOrg({ name: org.name, id: org.id });
}

const CreateCollabOrgView: React.FC<CreateCollabOrgViewProps> = ({
  onCancel,
  onCreated,
}) => {
  const { t } = useTranslation(["navigation", "common"]);
  const setCollabOrgs = useSetAtom(collabOrgsAtom);
  const setCollabMembers = useSetAtom(collabMembersAtom);
  const setCollabInvites = useSetAtom(collabInvitesAtom);
  const [pendingInvite, setPendingInvite] = useAtom(collabPendingInviteAtom);

  const [source, setSource] = useState<CreateOrgSource | null>(null);
  const [mode, setMode] = useState<CreateCollabOrgMode>(CREATE_MODE);
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [orgName, setOrgName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [identityKind, setIdentityKind] = useState<CollabIdentityKind>(
    COLLAB_IDENTITY_KIND.HUMAN
  );
  const [latestInviteLink, setLatestInviteLink] = useState("");
  const [repoScopesText, setRepoScopesText] = useState("");
  const [verificationStatus, setVerificationStatus] =
    useState<SetupVerificationStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    if (!pendingInvite) return;
    setSource(SUPABASE_SOURCE);
    setMode(JOIN_MODE);
    setInviteInput(pendingInvite.inviteCode);
    if (pendingInvite.supabaseUrl) setSupabaseUrl(pendingInvite.supabaseUrl);
    if (pendingInvite.anonKey) setAnonKey(pendingInvite.anonKey);
    setError(null);
    setPendingInvite(null);
  }, [pendingInvite, setPendingInvite]);

  const parsedInvite = useMemo(() => {
    const trimmed = inviteInput.trim();
    if (!trimmed) return undefined;
    try {
      return parseCollabInviteInput(trimmed);
    } catch {
      return undefined;
    }
  }, [inviteInput]);

  useEffect(() => {
    if (parsedInvite?.supabaseUrl && !supabaseUrl.trim()) {
      setSupabaseUrl(parsedInvite.supabaseUrl);
    }
    if (parsedInvite?.anonKey && !anonKey.trim()) {
      setAnonKey(parsedInvite.anonKey);
    }
  }, [anonKey, parsedInvite, supabaseUrl]);

  const sourceOptions = useMemo<SelectionGridOption<CreateOrgSource>[]>(
    () => [
      {
        key: LOCAL_SOURCE,
        label: t("navigation:collaboration.localOrg"),
      },
      {
        key: SUPABASE_SOURCE,
        label: t("navigation:collaboration.supabaseSyncOrg"),
      },
    ],
    [t]
  );

  const modeOptions = useMemo<SelectionGridOption<CreateCollabOrgMode>[]>(
    () => [
      {
        key: CREATE_MODE,
        label: t("navigation:collaboration.createOrg"),
      },
      {
        key: JOIN_MODE,
        label: t("navigation:collaboration.joinOrg"),
      },
    ],
    [t]
  );

  const identityOptions = useMemo<SelectionGridOption<CollabIdentityKind>[]>(
    () => [
      {
        key: COLLAB_IDENTITY_KIND.HUMAN,
        label: t("navigation:collaboration.identityHuman"),
      },
      {
        key: COLLAB_IDENTITY_KIND.AGENT,
        label: t("navigation:collaboration.identityAgent"),
      },
    ],
    [t]
  );

  const effectiveSupabaseUrl = parsedInvite?.supabaseUrl ?? supabaseUrl;
  const effectiveAnonKey = parsedInvite?.anonKey ?? anonKey;

  const canSubmit = useMemo(() => {
    if (loading || source === null) return false;
    if (source === LOCAL_SOURCE) return Boolean(orgName.trim());
    if (!displayName.trim()) return false;
    if (!effectiveSupabaseUrl.trim() || !effectiveAnonKey.trim()) return false;
    if (mode === CREATE_MODE) return Boolean(orgName.trim());
    return Boolean(inviteInput.trim());
  }, [
    displayName,
    effectiveAnonKey,
    effectiveSupabaseUrl,
    inviteInput,
    loading,
    mode,
    orgName,
    source,
  ]);

  const handleVerifySetup = useCallback(async () => {
    if (!supabaseUrl.trim() || !anonKey.trim() || verifying) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await supabaseSyncClient.verifySetup({
        supabaseUrl,
        anonKey,
      });
      setVerificationStatus(result.ok ? "ok" : "missing");
      if (!result.ok) {
        setError(t("navigation:collaboration.supabaseSetupMissing"));
      }
    } catch (err) {
      setVerificationStatus("missing");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  }, [anonKey, supabaseUrl, t, verifying]);

  const handleCopySetupSql = useCallback(async () => {
    await copyText(ORGII_SUPABASE_SETUP_SQL);
    setCopiedSql(true);
    window.setTimeout(() => setCopiedSql(false), 1500);
  }, []);

  const handleCreated = useCallback(
    async (org: CollabOrgRecord, member: CollabMemberRecord) => {
      const projectOrg = await ensureProjectOrgForCollabOrg(org);
      const canonicalOrg = { ...org, projectOrgId: projectOrg.id };
      setCollabOrgs((current) => upsertOrg(current, canonicalOrg));
      setCollabMembers((current) => upsertMember(current, member));
      onCreated?.({ source: SUPABASE_SOURCE, org: canonicalOrg, member });
      const invite = await supabaseSyncClient.createInvite({
        supabaseUrl: org.supabaseUrl ?? supabaseUrl,
        anonKey: org.supabaseAnonKey ?? anonKey,
        orgSecret: org.orgSecret,
        orgId: org.id,
        usageLimit: DEFAULT_INVITE_USAGE_LIMIT,
      });
      setCollabInvites((current) => upsertInvite(current, invite));
      setLatestInviteLink(invite.inviteLink);
    },
    [
      anonKey,
      onCreated,
      setCollabInvites,
      setCollabMembers,
      setCollabOrgs,
      supabaseUrl,
    ]
  );

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setCopied(false);
    setLoading(true);
    try {
      if (source === LOCAL_SOURCE) {
        const org = await projectApi.createOrg({ name: orgName });
        onCreated?.({ source: LOCAL_SOURCE, org });
        return;
      }

      if (mode === CREATE_MODE) {
        const result = await supabaseSyncClient.createOrg({
          supabaseUrl: effectiveSupabaseUrl,
          anonKey: effectiveAnonKey,
          name: orgName,
          displayName,
          identityKind: COLLAB_IDENTITY_KIND.HUMAN,
        });
        const repoScopes = repoScopesText
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        if (repoScopes.length > 0) {
          try {
            await supabaseSyncClient.updateOrgRepoScopes({
              supabaseUrl: effectiveSupabaseUrl,
              anonKey: effectiveAnonKey,
              orgSecret: result.org.orgSecret,
              orgId: result.org.id,
              repoScopes,
            });
          } catch (err) {
            setError(
              `Org created, but failed to set repo scopes: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
        await handleCreated(
          {
            ...result.org,
            repoScopes: repoScopes.length > 0 ? repoScopes : undefined,
          },
          result.member
        );
        return;
      }

      const parsed = parseCollabInviteInput(inviteInput);
      const result = await supabaseSyncClient.acceptInvite({
        supabaseUrl: parsed.supabaseUrl ?? effectiveSupabaseUrl,
        anonKey: parsed.anonKey ?? effectiveAnonKey,
        inviteCode: parsed.inviteCode,
        displayName,
        identityKind,
      });
      const projectOrg = await ensureProjectOrgForCollabOrg(result.org);
      const canonicalOrg = { ...result.org, projectOrgId: projectOrg.id };
      setCollabOrgs((current) => upsertOrg(current, canonicalOrg));
      setCollabMembers((current) => upsertMember(current, result.member));
      onCreated?.({
        source: SUPABASE_SOURCE,
        org: canonicalOrg,
        member: result.member,
      });
      setLatestInviteLink("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [
    canSubmit,
    displayName,
    effectiveAnonKey,
    effectiveSupabaseUrl,
    handleCreated,
    identityKind,
    inviteInput,
    mode,
    onCreated,
    orgName,
    repoScopesText,
    setCollabMembers,
    setCollabOrgs,
    source,
  ]);

  const handleCopyInvite = useCallback(async () => {
    if (!latestInviteLink) return;
    await copyText(latestInviteLink);
    setCopied(true);
  }, [latestInviteLink]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          className="mx-auto flex h-full w-full max-w-[932px] flex-col gap-4 overflow-y-auto px-4"
          data-testid="create-collab-org-body"
        >
          <SectionContainer bare>
            <SectionRow
              label={t("navigation:collaboration.orgSource")}
              layout="vertical"
              required
            >
              <SelectionGrid
                options={sourceOptions}
                selected={source}
                columns={2}
                cardVariant="subtle"
                compactCards
                onSelect={setSource}
              />
            </SectionRow>
          </SectionContainer>

          {source === SUPABASE_SOURCE && (
            <SectionContainer bare>
              <SectionRow
                label={t("navigation:collaboration.setupMode")}
                layout="vertical"
              >
                <SelectionGrid
                  options={modeOptions}
                  selected={mode}
                  columns={2}
                  cardVariant="subtle"
                  compactCards
                  onSelect={setMode}
                />
              </SectionRow>
            </SectionContainer>
          )}

          {source !== null && (
            <SectionContainer bare>
              {mode === CREATE_MODE || source === LOCAL_SOURCE ? (
                <SectionRow
                  label={t("navigation:collaboration.orgName")}
                  layout="vertical"
                  required
                >
                  <Input
                    value={orgName}
                    onChange={setOrgName}
                    placeholder={t(
                      "navigation:collaboration.orgNamePlaceholder"
                    )}
                    style={COLLAB_FORM_CONTROL_STYLE}
                  />
                </SectionRow>
              ) : (
                <SectionRow
                  label={t("navigation:collaboration.inviteCode")}
                  layout="vertical"
                  required
                >
                  <Input
                    value={inviteInput}
                    onChange={setInviteInput}
                    placeholder={t(
                      "navigation:collaboration.inviteCodePlaceholder"
                    )}
                    style={COLLAB_FORM_CONTROL_STYLE}
                  />
                </SectionRow>
              )}

              {source === SUPABASE_SOURCE && (
                <SectionRow
                  label={t("navigation:collaboration.joinAs")}
                  layout="vertical"
                  required
                >
                  <Input
                    value={displayName}
                    onChange={setDisplayName}
                    placeholder={t(
                      "navigation:collaboration.joinAsPlaceholder"
                    )}
                    style={COLLAB_FORM_CONTROL_STYLE}
                  />
                </SectionRow>
              )}
            </SectionContainer>
          )}

          {source === SUPABASE_SOURCE && (
            <>
              <SectionContainer bare>
                <SectionRow
                  label={t("navigation:collaboration.supabaseUrl")}
                  layout="vertical"
                  required
                >
                  <Input
                    value={supabaseUrl}
                    onChange={setSupabaseUrl}
                    placeholder="https://your-project.supabase.co"
                    type="url"
                    style={COLLAB_FORM_CONTROL_STYLE}
                  />
                </SectionRow>
                <SectionRow
                  label={t("navigation:collaboration.supabaseAnonKey")}
                  layout="vertical"
                  required
                >
                  <Input
                    value={anonKey}
                    onChange={setAnonKey}
                    placeholder="eyJhbGciOi..."
                    style={COLLAB_FORM_CONTROL_STYLE}
                  />
                </SectionRow>
                {mode === CREATE_MODE ? (
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      htmlType="button"
                      size="small"
                      disabled={
                        !supabaseUrl.trim() || !anonKey.trim() || verifying
                      }
                      loading={verifying}
                      onClick={() => void handleVerifySetup()}
                    >
                      {t("navigation:collaboration.verifySupabaseSetup")}
                    </Button>
                    <Button
                      htmlType="button"
                      size="small"
                      onClick={() => void handleCopySetupSql()}
                    >
                      {copiedSql
                        ? t("navigation:collaboration.copiedSetupSql")
                        : t("navigation:collaboration.copySetupSql")}
                    </Button>
                    <Button
                      htmlType="button"
                      size="small"
                      onClick={() =>
                        window.open(SUPABASE_SQL_EDITOR_URL, "_blank")
                      }
                    >
                      {t("navigation:collaboration.openSupabaseSqlEditor")}
                    </Button>
                    {verificationStatus === "ok" ? (
                      <span className="text-[12px] text-success-6">
                        {t("navigation:collaboration.supabaseSetupVerified")}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </SectionContainer>

              {mode === CREATE_MODE ? (
                <CollapsibleSection
                  title={t("navigation:collaboration.supabaseSetupTitle")}
                  defaultOpen={false}
                  compact
                  headerRowClassName="h-5 px-1"
                  titleButtonClassName="text-[12px] font-medium text-text-2 hover:text-text-1"
                  chevronSize={12}
                >
                  <div className="cursor-text select-text px-1 text-[12px] leading-[18px] text-text-2">
                    <Markdown
                      textContent={SUPABASE_SETUP_MARKDOWN}
                      useChatCodeBlock
                      skipPreprocess
                    />
                  </div>
                </CollapsibleSection>
              ) : null}
            </>
          )}

          {source === SUPABASE_SOURCE && mode === CREATE_MODE && (
            <SectionContainer bare>
              <SectionRow
                label={t("navigation:collaboration.repoScopes")}
                layout="vertical"
              >
                <textarea
                  value={repoScopesText}
                  onChange={(event) => setRepoScopesText(event.target.value)}
                  placeholder={t(
                    "navigation:collaboration.repoScopesPlaceholder"
                  )}
                  rows={3}
                  className="focus:border-accent-5 w-full resize-y rounded border border-border-2 bg-bg-1 px-2 py-1 text-sm text-text-1 outline-none"
                  style={COLLAB_FORM_CONTROL_STYLE}
                />
                <p className="text-[12px] text-text-2">
                  {t("navigation:collaboration.repoScopesHelp")}
                </p>
              </SectionRow>
            </SectionContainer>
          )}

          {source === SUPABASE_SOURCE && mode === JOIN_MODE && (
            <SectionContainer bare>
              <SectionRow
                label={t("navigation:collaboration.identityKind")}
                layout="vertical"
                required
              >
                <SelectionGrid
                  options={identityOptions}
                  selected={identityKind}
                  columns={2}
                  cardVariant="subtle"
                  compactCards
                  onSelect={setIdentityKind}
                />
              </SectionRow>
            </SectionContainer>
          )}

          {latestInviteLink && (
            <SectionContainer bare>
              <SectionRow
                label={t("navigation:collaboration.inviteReady")}
                layout="vertical"
              >
                <div className="space-y-3">
                  <Input
                    readOnly
                    value={latestInviteLink}
                    style={COLLAB_FORM_CONTROL_STYLE}
                  />
                  <Button size="small" onClick={() => void handleCopyInvite()}>
                    {copied
                      ? t("navigation:collaboration.copiedInvite")
                      : t("navigation:collaboration.copyInvite")}
                  </Button>
                </div>
              </SectionRow>
            </SectionContainer>
          )}

          {error && <p className="text-sm text-danger-6">{error}</p>}
        </div>
      </div>

      <div className={`${PANEL_FOOTER_TOKENS.container} justify-end`}>
        <Button variant="secondary" size="small" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
        <Button
          variant="primary"
          size="small"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          loading={loading}
          data-testid="create-collab-org-submit"
        >
          {source === LOCAL_SOURCE || mode === CREATE_MODE
            ? t("navigation:collaboration.createOrg")
            : t("navigation:collaboration.joinOrg")}
        </Button>
      </div>
    </div>
  );
};

export default CreateCollabOrgView;
