/**
 * GitHubLocalDetect — Detects local GitHub credentials and displays them
 * in a SettingsTable with enable toggles for storable token sources.
 *
 * Flow: Detect button → table appears → user toggles a source → parent
 * receives the selected token via onReady and stores it on Add click.
 */
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import SettingsTable, {
  SETTINGS_TABLE_CELL,
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import Switch from "@src/components/Switch";
import { useGitHubLocalDetect } from "@src/hooks/git/useGitHubLocalDetect";
import {
  SectionContainer,
  SectionRow,
} from "@src/modules/shared/layouts/SectionLayout";

// ============================================
// Types
// ============================================

interface DetectedCredentialRow {
  id: string;
  source: string;
  value: string;
  token: string | null;
}

interface GitHubLocalDetectProps {
  /** Called with the selected token when toggled on, or null when toggled off */
  onReady?: (token: string | null) => void;
}

// ============================================
// Component
// ============================================

const GitHubLocalDetect: React.FC<GitHubLocalDetectProps> = ({ onReady }) => {
  const { t } = useTranslation("integrations");
  const { detecting, results, detectError, detect } = useGitHubLocalDetect();

  const [selectedSource, setSelectedSource] = useState<string | null>(null);

  const hasResults = results !== null;
  const hasAnything =
    !!results?.gh_cli ||
    (results?.ssh_keys.length ?? 0) > 0 ||
    !!results?.credential_helper ||
    !!results?.git_credentials_has_github;

  const handleDetect = useCallback(async () => {
    setSelectedSource(null);
    onReady?.(null);
    const detected = await detect();
    if (!detected) return;
    const firstToken =
      detected.gh_cli?.token ?? detected.credential_helper?.token ?? null;
    if (firstToken) {
      const sourceId =
        detected.gh_cli?.token === firstToken ? "gh_cli" : "credential_helper";
      setSelectedSource(sourceId);
      onReady?.(firstToken);
    }
  }, [detect, onReady]);

  const handleToggle = useCallback(
    (row: DetectedCredentialRow, checked: boolean) => {
      if (checked && row.token) {
        setSelectedSource(row.id);
        onReady?.(row.token);
      } else {
        setSelectedSource(null);
        onReady?.(null);
      }
    },
    [onReady]
  );

  const rows = useMemo<DetectedCredentialRow[]>(() => {
    if (!results) return [];
    const items: DetectedCredentialRow[] = [];

    if (results.gh_cli) {
      items.push({
        id: "gh_cli",
        source: t("git.ghCliFound"),
        value:
          results.gh_cli.username || results.gh_cli.token.slice(0, 12) + "…",
        token: results.gh_cli.token,
      });
    }

    if (results.credential_helper) {
      const helper = results.credential_helper.helper;
      const user = results.credential_helper.username;
      items.push({
        id: "credential_helper",
        source: t("git.credentialHelperFound"),
        value: user ? `${helper} — ${user}` : helper,
        token: results.credential_helper.token ?? null,
      });
    }

    for (const key of results.ssh_keys) {
      items.push({
        id: `ssh:${key.filename}`,
        source: t("git.sshKeyLabel"),
        value: `${key.key_type.replace("ssh-", "")} — ${key.comment || key.filename}`,
        token: null,
      });
    }

    if (results.git_credentials_has_github && !results.credential_helper) {
      items.push({
        id: "git_credentials",
        source: t("git.gitCredentialsFound"),
        value: "github.com",
        token: null,
      });
    }

    return items;
  }, [results, t]);

  const columns = useMemo<SettingsTableColumn<DetectedCredentialRow>[]>(
    () => [
      {
        key: "source",
        label: t("git.credentialSource"),
        width: SETTINGS_TABLE_COL.fill,
        renderCell: (row) => (
          <span className={SETTINGS_TABLE_CELL.primary}>{row.source}</span>
        ),
      },
      {
        key: "value",
        label: t("git.credentialValue"),
        width: SETTINGS_TABLE_COL.fill,
        renderCell: (row) => (
          <span className={SETTINGS_TABLE_CELL.value}>{row.value}</span>
        ),
      },
      {
        key: "enable",
        label: t("keyVault.info.enable"),
        width: SETTINGS_TABLE_COL.hug,
        align: "right" as const,
        renderCell: (row) =>
          row.token ? (
            <div className="flex items-center justify-end">
              <Switch
                checked={selectedSource === row.id}
                onChange={(checked) => handleToggle(row, checked)}
              />
            </div>
          ) : null,
      },
    ],
    [t, selectedSource, handleToggle]
  );

  const detected = hasResults && hasAnything;

  return (
    <>
      <SectionContainer>
        <SectionRow
          label={t("git.detectFromSystem")}
          description={t("git.detectFromSystemDesc")}
          required
        >
          <Button
            variant="primary"
            appearance={detected ? "outline" : "solid"}
            size="default"
            loading={detecting}
            disabled={detecting}
            onClick={handleDetect}
            className="h-8 min-h-8"
          >
            {detected ? `✓ ${t("keyVault.detected")}` : t("keyVault.detect")}
          </Button>
        </SectionRow>
      </SectionContainer>

      {detectError && (
        <InlineAlert type="danger" title={t("git.detectFailed")}>
          {detectError}
        </InlineAlert>
      )}

      {detected && (
        <SettingsTable
          hover
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          headerHeight="tall"
          stickyHeader={false}
        />
      )}

      {hasResults && !hasAnything && (
        <InlineAlert type="warning" title={t("git.noCredentialsFound")}>
          {t("git.noCredentialsHint")}
        </InlineAlert>
      )}
    </>
  );
};

export default GitHubLocalDetect;
