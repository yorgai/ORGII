import { memo } from "react";
import { useTranslation } from "react-i18next";

import { ADD_CONNECTION_TEXT_INPUT_CLASS } from "./formInputClass";

export interface MysqlConnectionFieldsProps {
  mysqlHost: string;
  mysqlPort: string;
  mysqlDatabase: string;
  mysqlUser: string;
  mysqlPassword: string;
  onMysqlHostChange: (value: string) => void;
  onMysqlPortChange: (value: string) => void;
  onMysqlDatabaseChange: (value: string) => void;
  onMysqlUserChange: (value: string) => void;
  onMysqlPasswordChange: (value: string) => void;
}

export const MysqlConnectionFields = memo(function MysqlConnectionFields({
  mysqlHost,
  mysqlPort,
  mysqlDatabase,
  mysqlUser,
  mysqlPassword,
  onMysqlHostChange,
  onMysqlPortChange,
  onMysqlDatabaseChange,
  onMysqlUserChange,
  onMysqlPasswordChange,
}: MysqlConnectionFieldsProps) {
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
            value={mysqlHost}
            onChange={(event) => onMysqlHostChange(event.target.value)}
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
            value={mysqlPort}
            onChange={(event) => onMysqlPortChange(event.target.value)}
            placeholder="3306"
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
          value={mysqlDatabase}
          onChange={(event) => onMysqlDatabaseChange(event.target.value)}
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
            value={mysqlUser}
            onChange={(event) => onMysqlUserChange(event.target.value)}
            placeholder="root"
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
            value={mysqlPassword}
            onChange={(event) => onMysqlPasswordChange(event.target.value)}
            className={ADD_CONNECTION_TEXT_INPUT_CLASS}
          />
        </div>
      </div>
    </>
  );
});
