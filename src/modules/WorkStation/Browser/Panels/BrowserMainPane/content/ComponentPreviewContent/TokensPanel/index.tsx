/**
 * TokensPanel - Design tokens editor
 * Allows viewing and editing CSS variables/design tokens
 */
import {
  ChevronDown,
  ChevronRight,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { type FC, memo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRefreshSpin } from "@src/hooks/ui";
import type { TokenInfo } from "@src/modules/WorkStation/Browser/hooks/useDesignTokens";
import { Placeholder } from "@src/modules/shared/layouts/blocks";

interface TokensPanelProps {
  tokens: TokenInfo[];
  loading: boolean;
  onAddToken: (name: string, value?: string) => void;
  onRemoveToken: (name: string) => void;
  onUpdateToken: (name: string, value: string) => void;
  onResetToken: (name: string) => void;
  onRefresh: () => void;
}

interface TokenRowProps {
  token: TokenInfo;
  onUpdate: (name: string, value: string) => void;
  onReset: (name: string) => void;
  onRemove: (name: string) => void;
}

const TokenRow: FC<TokenRowProps> = memo(
  ({ token, onUpdate, onReset, onRemove }) => {
    const { t } = useTranslation();
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(token.value);

    const handleSave = () => {
      onUpdate(token.name, editValue);
      setIsEditing(false);
    };

    return (
      <div className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-fill-3">
        {/* Token name */}
        <span
          className={`flex-1 truncate text-[11px] ${
            token.isKnown ? "text-text-2" : "text-warning-6"
          }`}
          title={token.isKnown ? token.name : `${token.name} (unknown)`}
        >
          --{token.name}
        </span>

        {/* Value */}
        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onBlur={handleSave}
            onKeyDown={(event) => event.key === "Enter" && handleSave()}
            className="w-20 rounded border border-border-2 bg-pane-input px-1 py-0.5 text-[10px] text-text-1"
            autoFocus
          />
        ) : (
          <span
            onClick={() => {
              setEditValue(token.value);
              setIsEditing(true);
            }}
            className="w-20 cursor-pointer truncate rounded bg-fill-1 px-1 py-0.5 text-[10px] text-text-3 hover:bg-fill-2"
            title={token.value}
          >
            {token.value || "(empty)"}
          </span>
        )}

        {/* Actions */}
        <div className="flex opacity-0 group-hover:opacity-100">
          {token.customized && (
            <button
              onClick={() => onReset(token.name)}
              className="p-0.5 text-text-4 hover:text-text-2"
              title={t("tooltips.resetToDefault")}
            >
              <RotateCcw size={10} />
            </button>
          )}
          {!token.autoDetected && (
            <button
              onClick={() => onRemove(token.name)}
              className="p-0.5 text-text-4 hover:text-red-500"
              title={t("actions.remove")}
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>
    );
  }
);

TokenRow.displayName = "TokenRow";

export const TokensPanel: FC<TokensPanelProps> = memo(
  ({
    tokens,
    loading,
    onAddToken,
    onRemoveToken,
    onUpdateToken,
    onResetToken,
    onRefresh,
  }) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(true);
    const [newTokenName, setNewTokenName] = useState("");
    const [showAddForm, setShowAddForm] = useState(false);

    const handleAddToken = () => {
      if (newTokenName.trim()) {
        onAddToken(newTokenName.trim());
        setNewTokenName("");
        setShowAddForm(false);
      }
    };

    const { spinClass: refreshSpinClass, handleClick: handleRefreshClick } =
      useRefreshSpin(onRefresh, loading);

    const autoDetectedTokens = tokens.filter((token) => token.autoDetected);
    const manualTokens = tokens.filter((token) => !token.autoDetected);

    return (
      <div className="border-b border-border-2">
        {/* Header */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-fill-3"
        >
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown size={12} className="text-text-3" />
            ) : (
              <ChevronRight size={12} className="text-text-3" />
            )}
            <Palette size={12} className="text-primary-6" />
            <span className="text-xs font-medium uppercase text-text-3">
              Tokens ({tokens.length})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(event) => {
                event.stopPropagation();
                handleRefreshClick();
              }}
              className="rounded p-1 text-text-4 hover:bg-fill-2 hover:text-text-2"
              title={t("tooltips.refreshTokens")}
            >
              <RefreshCw size={10} className={refreshSpinClass} />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                setShowAddForm(true);
              }}
              className="rounded p-1 text-text-4 hover:bg-fill-2 hover:text-text-2"
              title={t("tooltips.addToken")}
            >
              <Plus size={10} />
            </button>
          </div>
        </button>

        {/* Content */}
        {isExpanded && (
          <div className="px-3 pb-3">
            {/* Add form */}
            {showAddForm && (
              <div className="mb-2 flex gap-1">
                <input
                  type="text"
                  value={newTokenName}
                  onChange={(event) => setNewTokenName(event.target.value)}
                  onKeyDown={(event) =>
                    event.key === "Enter" && handleAddToken()
                  }
                  placeholder={t("workstation.tokenName")}
                  className="flex-1 rounded border border-border-2 bg-pane-input px-2 py-1 text-xs text-text-1"
                  autoFocus
                />
                <button
                  onClick={handleAddToken}
                  className="rounded bg-primary-6 px-2 py-1 text-xs text-white"
                >
                  Add
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="rounded p-1 text-text-3 hover:bg-fill-2"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Token list */}
            {tokens.length === 0 ? (
              <Placeholder
                variant={loading ? "loading" : "empty"}
                title={
                  loading
                    ? t("placeholders.scanning")
                    : t("placeholders.noTokensDetected")
                }
              />
            ) : (
              <div className="flex flex-col gap-1">
                {/* Auto-detected tokens */}
                {autoDetectedTokens.length > 0 && (
                  <div className="mb-1">
                    <div className="mb-1 text-[10px] text-text-4">
                      Auto-detected
                    </div>
                    {autoDetectedTokens.map((token) => (
                      <TokenRow
                        key={token.name}
                        token={token}
                        onUpdate={onUpdateToken}
                        onReset={onResetToken}
                        onRemove={onRemoveToken}
                      />
                    ))}
                  </div>
                )}

                {/* Manual tokens */}
                {manualTokens.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] text-text-4">
                      {t("workstation.manualMode")}
                    </div>
                    {manualTokens.map((token) => (
                      <TokenRow
                        key={token.name}
                        token={token}
                        onUpdate={onUpdateToken}
                        onReset={onResetToken}
                        onRemove={onRemoveToken}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

TokensPanel.displayName = "TokensPanel";
