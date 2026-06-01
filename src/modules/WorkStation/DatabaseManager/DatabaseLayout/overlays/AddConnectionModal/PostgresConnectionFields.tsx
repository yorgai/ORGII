import { memo } from "react";
import { useTranslation } from "react-i18next";

import { ADD_CONNECTION_TEXT_INPUT_CLASS } from "./formInputClass";

export interface PostgresConnectionFieldsProps {
  pgHost: string;
  pgPort: string;
  pgDatabase: string;
  pgUser: string;
  pgPassword: string;
  pgSsl: boolean;
  onPgHostChange: (value: string) => void;
  onPgPortChange: (value: string) => void;
  onPgDatabaseChange: (value: string) => void;
  onPgUserChange: (value: string) => void;
  onPgPasswordChange: (value: string) => void;
  onPgSslChange: (value: boolean) => void;
}

export const PostgresConnectionFields = memo(function PostgresConnectionFields({
  pgHost,
  pgPort,
  pgDatabase,
  pgUser,
  pgPassword,
  pgSsl,
  onPgHostChange,
  onPgPortChange,
  onPgDatabaseChange,
  onPgUserChange,
  onPgPasswordChange,
  onPgSslChange,
}: PostgresConnectionFieldsProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-medium text-text-2">
            {t("database.host")}
          </label>
          <input
            type="text"
            value={pgHost}
            onChange={(event) => onPgHostChange(event.target.value)}
            placeholder="localhost"
            className={ADD_CONNECTION_TEXT_INPUT_CLASS}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-2">
            {t("database.port")}
          </label>
          <input
            type="text"
            value={pgPort}
            onChange={(event) => onPgPortChange(event.target.value)}
            placeholder="5432"
            className={ADD_CONNECTION_TEXT_INPUT_CLASS}
          />
        </div>
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-text-2">
          {t("database.database")}
        </label>
        <input
          type="text"
          value={pgDatabase}
          onChange={(event) => onPgDatabaseChange(event.target.value)}
          placeholder="mydb"
          className={ADD_CONNECTION_TEXT_INPUT_CLASS}
        />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-2">
            {t("database.user")}
          </label>
          <input
            type="text"
            value={pgUser}
            onChange={(event) => onPgUserChange(event.target.value)}
            placeholder="postgres"
            className={ADD_CONNECTION_TEXT_INPUT_CLASS}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-2">
            {t("database.password")}{" "}
            <span className="font-normal text-text-4">({t("optional")})</span>
          </label>
          <input
            type="password"
            value={pgPassword}
            onChange={(event) => onPgPasswordChange(event.target.value)}
            className={ADD_CONNECTION_TEXT_INPUT_CLASS}
          />
        </div>
      </div>
      <div className="mb-4 flex items-center gap-2">
        <input
          type="checkbox"
          id="pg-ssl"
          checked={pgSsl}
          onChange={(event) => onPgSslChange(event.target.checked)}
          className="h-4 w-4 rounded border-border-2"
        />
        <label htmlFor="pg-ssl" className="text-xs text-text-2">
          {t("database.requireSsl")}
        </label>
      </div>
    </>
  );
});
