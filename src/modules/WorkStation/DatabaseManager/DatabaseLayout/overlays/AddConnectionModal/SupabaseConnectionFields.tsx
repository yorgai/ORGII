import { memo } from "react";
import { useTranslation } from "react-i18next";

import { ADD_CONNECTION_TEXT_INPUT_CLASS } from "./formInputClass";

export interface SupabaseConnectionFieldsProps {
  supabaseUrl: string;
  supabaseAccessToken: string;
  onSupabaseUrlChange: (value: string) => void;
  onSupabaseAccessTokenChange: (value: string) => void;
}

export const SupabaseConnectionFields = memo(function SupabaseConnectionFields({
  supabaseUrl,
  supabaseAccessToken,
  onSupabaseUrlChange,
  onSupabaseAccessTokenChange,
}: SupabaseConnectionFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-text-2">
          {t("database.projectUrl")}
        </label>
        <input
          type="text"
          value={supabaseUrl}
          onChange={(event) => onSupabaseUrlChange(event.target.value)}
          placeholder="https://xxxxx.supabase.co"
          className={ADD_CONNECTION_TEXT_INPUT_CLASS}
        />
        <p className="mt-1 text-[10px] text-text-4">
          {t("database.supabaseHint")}
        </p>
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-text-2">
          {t("database.accessToken")}
        </label>
        <input
          type="password"
          value={supabaseAccessToken}
          onChange={(event) => onSupabaseAccessTokenChange(event.target.value)}
          placeholder="sbp_xxx..."
          className={ADD_CONNECTION_TEXT_INPUT_CLASS}
        />
        <p className="mt-1 text-[10px] text-text-4">
          {t("database.supabaseTokenHint")}{" "}
          <a
            href="https://supabase.com/dashboard/account/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-6 hover:underline"
          >
            supabase.com/dashboard/account/tokens
          </a>
        </p>
      </div>
    </>
  );
});
