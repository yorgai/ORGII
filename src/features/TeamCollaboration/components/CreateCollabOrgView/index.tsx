import { useSetAtom } from "jotai";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { DetailSplitLayout } from "@src/modules/ProjectManager/shared";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";
import SelectionGrid from "@src/scaffold/WizardSystem/primitives/SelectionGrid";
import type { SelectionGridOption } from "@src/scaffold/WizardSystem/primitives/SelectionGrid";
import {
  collabInvitesAtom,
  collabMembersAtom,
  collabOrgsAtom,
} from "@src/store/collaboration/collabOrgsAtom";
import { parseCollabInviteInput } from "@src/store/collaboration/protocol";
import { COLLAB_IDENTITY_KIND } from "@src/store/collaboration/types";
import type {
  CollabIdentityKind,
  CollabInviteRecord,
  CollabMemberRecord,
  CollabOrgRecord,
} from "@src/store/collaboration/types";
import { copyText } from "@src/util/data/clipboard";

import {
  acceptCollabInvite,
  createCollabInvite,
  createCollabOrg,
} from "../../collabHubClient";

const CREATE_MODE = "create";
const JOIN_MODE = "join";

type CreateCollabOrgMode = typeof CREATE_MODE | typeof JOIN_MODE;

const COLLAB_FORM_CONTROL_STYLE = {
  width: "100%",
  maxWidth: "100%",
} as const;

export interface CreateCollabOrgViewProps {
  onCancel: () => void;
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

const CreateCollabOrgView: React.FC<CreateCollabOrgViewProps> = ({
  onCancel,
}) => {
  const { t } = useTranslation(["navigation", "common"]);
  const setCollabOrgs = useSetAtom(collabOrgsAtom);
  const setCollabMembers = useSetAtom(collabMembersAtom);
  const setCollabInvites = useSetAtom(collabInvitesAtom);

  const [mode, setMode] = useState<CreateCollabOrgMode>(CREATE_MODE);
  const [hubUrl, setHubUrl] = useState("");
  const [orgName, setOrgName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [identityKind, setIdentityKind] = useState<CollabIdentityKind>(
    COLLAB_IDENTITY_KIND.HUMAN
  );
  const [latestInviteLink, setLatestInviteLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const canSubmit = useMemo(() => {
    if (loading || !hubUrl.trim() || !displayName.trim()) return false;
    if (mode === CREATE_MODE) return Boolean(orgName.trim());
    return Boolean(inviteInput.trim());
  }, [displayName, hubUrl, inviteInput, loading, mode, orgName]);

  const handleCreated = useCallback(
    async (org: CollabOrgRecord, member: CollabMemberRecord) => {
      setCollabOrgs((current) => upsertOrg(current, org));
      setCollabMembers((current) => upsertMember(current, member));
      const invite = await createCollabInvite({
        hubUrl: org.hubUrl ?? hubUrl,
        orgId: org.id,
        accessToken: member.accessToken ?? "",
      });
      setCollabInvites((current) => upsertInvite(current, invite));
      setLatestInviteLink(invite.inviteLink);
    },
    [hubUrl, setCollabInvites, setCollabMembers, setCollabOrgs]
  );

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setError(null);
    setCopied(false);
    setLoading(true);
    try {
      if (mode === CREATE_MODE) {
        const result = await createCollabOrg({
          hubUrl,
          name: orgName,
          displayName,
          identityKind: COLLAB_IDENTITY_KIND.HUMAN,
        });
        await handleCreated(result.org, result.member);
        return;
      }

      const parsedInvite = parseCollabInviteInput(inviteInput);
      const result = await acceptCollabInvite({
        hubUrl: parsedInvite.hubUrl ?? hubUrl,
        inviteCode: parsedInvite.inviteCode,
        displayName,
        identityKind,
      });
      setCollabOrgs((current) => upsertOrg(current, result.org));
      setCollabMembers((current) => upsertMember(current, result.member));
      setLatestInviteLink("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [
    canSubmit,
    displayName,
    handleCreated,
    hubUrl,
    inviteInput,
    mode,
    orgName,
    setCollabMembers,
    setCollabOrgs,
  ]);

  const handleCopyInvite = useCallback(async () => {
    if (!latestInviteLink) return;
    await copyText(latestInviteLink);
    setCopied(true);
  }, [latestInviteLink]);

  return (
    <DetailSplitLayout
      title={t("navigation:collaboration.addOrg")}
      borderlessHeader
      hideHeader
      leftContent={
        <div
          className="min-h-0 flex-1 overflow-auto py-4"
          data-testid="create-collab-org-body"
        >
          <div className="mx-auto flex h-full w-full max-w-[932px] flex-col gap-4 px-4">
            <SectionContainer color="chatPanelInfo">
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

            <SectionContainer color="chatPanelInfo">
              {mode === CREATE_MODE ? (
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

              <SectionRow
                label={t("navigation:collaboration.joinAs")}
                layout="vertical"
                required
              >
                <Input
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder={t("navigation:collaboration.joinAsPlaceholder")}
                  style={COLLAB_FORM_CONTROL_STYLE}
                />
              </SectionRow>
            </SectionContainer>

            <SectionContainer color="chatPanelInfo">
              <SectionRow
                label={t("navigation:collaboration.hubUrl")}
                layout="vertical"
                required
              >
                <Input
                  value={hubUrl}
                  onChange={setHubUrl}
                  placeholder="https://team.example.workers.dev"
                  type="url"
                  style={COLLAB_FORM_CONTROL_STYLE}
                />
              </SectionRow>
            </SectionContainer>

            {mode === JOIN_MODE && (
              <SectionContainer color="chatPanelInfo">
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
              <SectionContainer color="chatPanelInfo">
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
                    <Button
                      size="small"
                      onClick={() => void handleCopyInvite()}
                    >
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
      }
      footer={
        <>
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
            {mode === CREATE_MODE
              ? t("navigation:collaboration.createOrg")
              : t("navigation:collaboration.joinOrg")}
          </Button>
        </>
      }
    />
  );
};

export default CreateCollabOrgView;
