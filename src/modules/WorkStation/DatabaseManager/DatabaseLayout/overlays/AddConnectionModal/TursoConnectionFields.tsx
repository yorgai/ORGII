import { memo } from "react";
import { useTranslation } from "react-i18next";

import { ADD_CONNECTION_TEXT_INPUT_CLASS } from "./formInputClass";

export interface TursoConnectionFieldsProps {
  tursoUrl: string;
  tursoToken: string;
  onTursoUrlChange: (value: string) => void;
  onTursoTokenChange: (value: string) => void;
}

export const TursoConnectionFields = memo(function TursoConnectionFields({
  tursoUrl,
  tursoToken,
  onTursoUrlChange,
  onTursoTokenChange,
}: TursoConnectionFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-text-2">
          {t("database.databaseUrl")}
        </label>
        <input
          type="text"
          value={tursoUrl}
          onChange={(event) => onTursoUrlChange(event.target.value)}
          placeholder="libsql://my-db-username.turso.io"
          className={ADD_CONNECTION_TEXT_INPUT_CLASS}
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-text-2">
          {t("database.authToken")}{" "}
          <span className="font-normal text-text-4">({t("optional")})</span>
        </label>
        <input
          type="password"
          value={tursoToken}
          onChange={(event) => onTursoTokenChange(event.target.value)}
          placeholder="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9..."
          className={ADD_CONNECTION_TEXT_INPUT_CLASS}
        />
        <p className="mt-1 text-[10px] text-text-4">
          {t("database.tursoTokenHint")}
        </p>
      </div>
    </>
  );
});
