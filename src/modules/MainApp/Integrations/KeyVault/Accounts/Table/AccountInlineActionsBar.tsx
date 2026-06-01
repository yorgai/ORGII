import { RefreshCw } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import type { KeyVaultAccount } from "@src/hooks/keyVault";
import { useRefreshSpin } from "@src/hooks/ui";

import { InlineCardFooter } from "../../shared/InlineCardPrimitives";

interface AccountInlineActionsBarProps {
  account: KeyVaultAccount;
  refreshing?: boolean;
  refreshingModels?: boolean;
  onRefresh?: () => void | Promise<void>;
  onRefreshModels?: () => void | Promise<void>;
  onEdit?: () => void;
  onDisconnect?: (accountId: string, deleteType?: "local" | "cloud") => void;
}

export const AccountInlineActionsBar: React.FC<
  AccountInlineActionsBarProps
> = ({
  account,
  refreshing = false,
  refreshingModels = false,
  onRefresh,
  onRefreshModels,
  onEdit,
  onDisconnect,
}) => {
  const { t } = useTranslation("integrations");
  const { t: tCommon } = useTranslation();

  const { spinClass, handleClick: handleRefreshClick } = useRefreshSpin(
    onRefresh ?? (() => {}),
    refreshing
  );
  const { spinClass: modelSpinClass, handleClick: handleRefreshModelsClick } =
    useRefreshSpin(onRefreshModels ?? (() => {}), refreshingModels);

  const showEdit = !account.listingId && account.hasLocalKey && onEdit;

  return (
    <InlineCardFooter>
      {onRefresh ? (
        <Button
          variant="secondary"
          size="small"
          onClick={handleRefreshClick}
          disabled={refreshing}
          icon={<RefreshCw size={14} className={spinClass} />}
          title={tCommon("actions.refresh")}
        >
          {tCommon("actions.refresh")}
        </Button>
      ) : null}
      {onRefreshModels ? (
        <Button
          variant="secondary"
          size="small"
          onClick={handleRefreshModelsClick}
          disabled={refreshingModels}
          icon={<RefreshCw size={14} className={modelSpinClass} />}
          title={t("keyVault.cursorRefresh.modelsButton")}
        >
          {t("keyVault.cursorRefresh.modelsButton")}
        </Button>
      ) : null}
      {showEdit ? (
        <Button variant="secondary" size="small" onClick={onEdit}>
          {tCommon("actions.edit")}
        </Button>
      ) : null}
      {onDisconnect && account.hasLocalKey && account.isListed ? (
        <>
          <Button
            variant="danger"
            appearance="outline"
            size="small"
            onClick={() => onDisconnect(account.id, "local")}
          >
            {t("keyVault.removeLocal")}
          </Button>
          <Button
            variant="danger"
            appearance="outline"
            size="small"
            onClick={() => onDisconnect(account.id, "cloud")}
          >
            {t("keyVault.unlist")}
          </Button>
        </>
      ) : null}
      {onDisconnect && !(account.hasLocalKey && account.isListed) ? (
        <Button
          variant="danger"
          appearance="outline"
          size="small"
          onClick={() => onDisconnect(account.id)}
        >
          {account.hasLocalKey
            ? tCommon("actions.remove")
            : tCommon("actions.delete")}
        </Button>
      ) : null}
    </InlineCardFooter>
  );
};
