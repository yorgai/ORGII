import { Check, Copy } from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { getFullKey } from "@src/api/services/keyValidation";
import { CLI_AGENT } from "@src/api/tauri/rpc/schemas/validation";
import type { UsageItem } from "@src/api/types/keys";
import { isApiKeyProvider } from "@src/assets/providers";
import Message from "@src/components/Message";
import {
  getQuotaBgColorClass,
  getQuotaTextColorClass,
} from "@src/components/QuotaBar";
import StatusDot from "@src/components/StatusDot";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { useCopyCheck } from "@src/hooks/ui";
import { copyText } from "@src/util/data/clipboard";

import { InfoRow } from "../../../shared/InfoRow";
import {
  InlineCardColumnStack,
  InlineCardSplit,
} from "../../shared/InlineCardPrimitives";
import { KEY_VAULT_STATUS_DOT } from "../../statusColors";
import KeyHealthBadge from "../Detail/KeyHealthBadge";
import VerificationStatusBadge from "../Detail/VerificationStatusBadge";
import { AccountCompatibilitySection } from "./AccountCompatibilitySection";

interface AccountInlineStatusSectionProps {
  account: KeyVaultAccount;
}

function shouldShowAccountQuota(account: KeyVaultAccount): boolean {
  return Boolean(
    account.quotaInfo &&
    account.healthStatus !== "invalid" &&
    account.listingStatus !== "suspended"
  );
}

const CURSOR_PLAN_USAGE_TYPES = new Set<string>([
  "plan",
  "individual_overall",
  "team_pooled",
]);

function getUsagePercentUsed(item: UsageItem): number | null {
  if (item.limit == null || item.limit <= 0 || item.used == null) return null;
  return Math.min(100, Math.max(0, (item.used / item.limit) * 100));
}

function formatUsageValue(item: UsageItem): string {
  if (item.limit == null || item.limit <= 0) {
    return item.used != null ? String(item.used) : "—";
  }
  return `${item.used ?? 0}/${item.limit}`;
}

function hasTotalPercentUsed(
  quotaInfo: KeyVaultAccount["quotaInfo"]
): quotaInfo is NonNullable<KeyVaultAccount["quotaInfo"]> & {
  total_percent_used: number;
} {
  return (
    Boolean(quotaInfo) &&
    typeof (quotaInfo as { total_percent_used?: unknown })
      .total_percent_used === "number"
  );
}

function hasUsageItems(
  quotaInfo: KeyVaultAccount["quotaInfo"]
): quotaInfo is NonNullable<KeyVaultAccount["quotaInfo"]> & {
  usage_items: UsageItem[];
} {
  return (
    Boolean(quotaInfo) &&
    Array.isArray((quotaInfo as { usage_items?: unknown }).usage_items)
  );
}

export const AccountInlineStatusSection: React.FC<
  AccountInlineStatusSectionProps
> = ({ account }) => {
  const { t } = useTranslation("integrations");
  const { t: tCommon } = useTranslation();

  const modelCount = account.availableModels?.length ?? 0;
  const enabledModelCount = account.enabledModels?.length ?? 0;
  const isApiKey = isApiKeyProvider(account.modelType);
  const isCursorAccount = account.modelType === CLI_AGENT.CURSOR;
  const showApiKey =
    account.hasApiKey && account.authMethod !== "oauth" && account.hasLocalKey;
  const showCursorApiStatus = isCursorAccount && account.hasLocalKey;
  const showSessionToken =
    account.hasSessionToken && isCursorAccount && account.hasLocalKey;
  const showQuota = shouldShowAccountQuota(account);

  const isMarketAccount = account.isListed;

  const effectiveHealthStatus = (() => {
    if (account.listingStatus === "suspended") return "invalid";
    return account.healthStatus;
  })();

  const showHealthBadge =
    effectiveHealthStatus === "invalid" || effectiveHealthStatus === "degraded";

  const showVerificationStatus =
    isMarketAccount &&
    account.modelType === CLI_AGENT.CURSOR &&
    (account.listingStatus === "pending" ||
      account.listingStatus === "rejected");

  const showMarketHealthWarning =
    account.hasLocalKey &&
    account.isListed &&
    (account.marketHealthStatus === "invalid" ||
      account.marketHealthStatus === "degraded");

  const authMethodValue = (() => {
    if (account.authMethod === "oauth") {
      return account.modelType === CLI_AGENT.CURSOR
        ? t("keyVault.info.oauthSessionCapture")
        : account.modelType === CLI_AGENT.COPILOT
          ? t("keyVault.info.oauthGithubPat")
          : account.modelType === CLI_AGENT.KIRO
            ? t("keyVault.info.oauthAwsSso")
            : t("keyVault.info.oauthLogin");
    }
    return t("keyVault.info.apiKey");
  })();

  const quotaSummary = useMemo(() => {
    if (!showQuota || !account.quotaInfo) return null;

    const quotaInfo = account.quotaInfo;
    const planLabel = quotaInfo.plan_type
      ? quotaInfo.plan_type.charAt(0).toUpperCase() +
        quotaInfo.plan_type.slice(1)
      : null;
    const remainingPercent = hasTotalPercentUsed(quotaInfo)
      ? 100 - quotaInfo.total_percent_used
      : (quotaInfo.remaining_percentage ?? 0);

    return {
      planLabel,
      remainingPercent,
      barBgClass: getQuotaBgColorClass(remainingPercent),
      textColorClass: getQuotaTextColorClass(remainingPercent),
      isUnlimited: quotaInfo.is_unlimited === true,
    };
  }, [account.quotaInfo, showQuota]);

  const cursorQuotaItems = useMemo(() => {
    if (
      !showQuota ||
      account.modelType !== CLI_AGENT.CURSOR ||
      !hasUsageItems(account.quotaInfo)
    ) {
      return [];
    }

    const items = account.quotaInfo.usage_items.filter(
      (item: UsageItem) => item.enabled
    );
    const planItem = items.find((item: UsageItem) =>
      CURSOR_PLAN_USAGE_TYPES.has(item.usage_type)
    );
    const apiItem = items.find(
      (item: UsageItem) => item.usage_type === "on_demand"
    );
    return [planItem, apiItem].filter((item): item is UsageItem =>
      Boolean(item)
    );
  }, [account.modelType, account.quotaInfo, showQuota]);

  const copyApiKey = useCallback(async () => {
    const cred = await getFullKey(account.modelType, account.id);
    const key = cred?.api_key;
    if (!key) {
      Message.error({ content: tCommon("errors.notFound") });
      return;
    }
    await copyText(key);
    Message.success({ content: tCommon("status.copied") });
  }, [account.modelType, account.id, tCommon]);

  const { copied: apiKeyCopied, handleCopy: handleCopyApiKey } =
    useCopyCheck(copyApiKey);

  const statusLabel =
    {
      ready: t("status.ready"),
      needs_setup: t("status.needsSetup"),
      error: t("status.error"),
      expired: t("status.expired"),
      pending_approval: t("status.pendingApproval"),
    }[account.status] ?? account.status;

  const connectedAtLabel = account.connectedAt
    ? `${account.connectedAt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(account.connectedAt.getFullYear() === new Date().getFullYear()
          ? {}
          : { year: "numeric" }),
      })}, ${account.connectedAt.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}`
    : null;

  const accountUsageRows = (
    <>
      {modelCount > 0 ? (
        <InfoRow
          label={t("keyVault.info.availableModels")}
          value={t("keyVault.info.modelsEnabledAddable", {
            enabled: enabledModelCount,
            addable: modelCount - enabledModelCount,
          })}
        />
      ) : null}
      {quotaSummary ? (
        <>
          <InfoRow
            label={t("keyVault.quota.plan")}
            value={quotaSummary.planLabel ?? "—"}
          />
          {cursorQuotaItems.length > 0 ? (
            cursorQuotaItems.map((item) => {
              const percentUsed = getUsagePercentUsed(item);
              const remainingPercent = item.remaining_percentage;
              const barBgClass = getQuotaBgColorClass(remainingPercent);
              const textColorClass = getQuotaTextColorClass(remainingPercent);

              return (
                <InfoRow
                  key={item.usage_type}
                  label={
                    item.usage_type === "on_demand"
                      ? t("keyVault.quota.cursorApiUsage")
                      : t("keyVault.quota.cursorIncludedRequests")
                  }
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-fill-3">
                      <div
                        className={`h-full rounded-full transition-all ${barBgClass}`}
                        style={{ width: `${remainingPercent}%` }}
                      />
                    </div>
                    <span className={`shrink-0 text-[12px] ${textColorClass}`}>
                      {percentUsed == null
                        ? formatUsageValue(item)
                        : `${Math.round(percentUsed)}% used`}
                    </span>
                  </div>
                </InfoRow>
              );
            })
          ) : (
            <InfoRow label={t("keyVault.quota.quotaUsage")}>
              <div className="flex min-w-0 items-center gap-2">
                <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-fill-3">
                  <div
                    className={`h-full rounded-full transition-all ${quotaSummary.barBgClass}`}
                    style={{
                      width: `${
                        quotaSummary.isUnlimited
                          ? 100
                          : quotaSummary.remainingPercent
                      }%`,
                    }}
                  />
                </div>
                <span
                  className={`shrink-0 text-[12px] ${quotaSummary.textColorClass}`}
                >
                  {quotaSummary.isUnlimited
                    ? "∞"
                    : `${Math.round(quotaSummary.remainingPercent)}% left`}
                </span>
              </div>
            </InfoRow>
          )}
        </>
      ) : null}
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {showVerificationStatus ? (
        <VerificationStatusBadge
          listingStatus={account.listingStatus!}
          verificationData={account.verificationData}
          rejectionReason={account.rejectionReason}
        />
      ) : null}
      {showHealthBadge && !showVerificationStatus ? (
        <KeyHealthBadge
          context={account.hasLocalKey ? "local" : "listing"}
          healthStatus={effectiveHealthStatus}
          failureCount={account.failureCount}
          lastFailureMessage={account.lastFailureMessage}
          temporaryUnavailableUntil={account.temporaryUnavailableUntil}
          temporaryUnavailableReason={account.temporaryUnavailableReason}
          lastUpstreamStatus={account.lastUpstreamStatus}
          availableModelCount={account.availableModels?.length}
          enabledModelCount={account.enabledModels?.length}
        />
      ) : null}
      {showMarketHealthWarning ? (
        <KeyHealthBadge
          context="cloud_warning"
          healthStatus={account.marketHealthStatus}
          lastFailureMessage={account.marketFailureMessage}
        />
      ) : null}
      <InlineCardSplit
        equalColumns
        left={
          <InlineCardColumnStack>
            {account.authMethod ? (
              <InfoRow
                label={t("keyVault.info.authMethod")}
                value={authMethodValue}
              />
            ) : null}
            <InfoRow label={t("common:labels.status")}>
              <StatusDot
                color={KEY_VAULT_STATUS_DOT[account.status] ?? "bg-fill-3"}
                size="inline"
                label={statusLabel}
              />
            </InfoRow>
            <InfoRow label={t("tableHeaders.category")}>
              <span className="text-[12px] text-text-1">
                {isApiKey
                  ? t("keyVault.categoryApi")
                  : t("keyVault.categorySubscription")}
              </span>
            </InfoRow>
            {connectedAtLabel ? (
              <InfoRow
                label={t("keyVault.info.connectedAt")}
                value={connectedAtLabel}
              />
            ) : null}
            {showSessionToken ? (
              <InfoRow label={t("keyVault.info.cursorSessionAccess")}>
                <StatusDot
                  color="bg-success-6"
                  size="inline"
                  label={t("keyVault.info.cursorSessionReady")}
                />
              </InfoRow>
            ) : null}
            {account.baseUrl ? (
              <InfoRow
                label={t("keyVault.info.baseUrl")}
                value={account.baseUrl}
              />
            ) : null}
            {showCursorApiStatus ? (
              <InfoRow label={t("keyVault.info.cursorApiKeyAccess")}>
                <StatusDot
                  color={account.hasApiKey ? "bg-success-6" : "bg-text-4"}
                  size="inline"
                  label={
                    account.hasApiKey
                      ? t("keyVault.info.cursorApiKeyReady")
                      : t("keyVault.info.cursorApiKeyNotProvided")
                  }
                />
              </InfoRow>
            ) : null}
            {showApiKey ? (
              <InfoRow label={t("keyVault.info.apiKey")}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-text-1">
                    {account.apiKeyPreview ?? t("keyVault.info.configured")}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyApiKey}
                    className={`transition-colors ${apiKeyCopied ? "text-success-6" : "text-text-2 hover:text-text-1"}`}
                  >
                    {apiKeyCopied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </InfoRow>
            ) : null}
          </InlineCardColumnStack>
        }
        right={
          <InlineCardColumnStack>
            <AccountCompatibilitySection account={account} />
            {accountUsageRows}
          </InlineCardColumnStack>
        }
      />
      {account.description ? (
        <div className="flex min-w-0 flex-col gap-1 border-t border-border-2 pt-2">
          <span className="text-[12px] font-semibold text-text-1">
            {t("keyVault.descriptionOptional")}
          </span>
          <p className="whitespace-pre-wrap break-words text-[12px] text-text-2">
            {account.description}
          </p>
        </div>
      ) : null}
    </div>
  );
};
