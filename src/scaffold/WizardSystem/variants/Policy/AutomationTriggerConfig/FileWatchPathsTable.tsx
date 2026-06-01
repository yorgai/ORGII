import { Trash2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import SettingsTable, {
  SETTINGS_TABLE_COL,
  type SettingsTableColumn,
} from "@src/components/SettingsTable";
import { SettingsTableAddFooter } from "@src/components/SettingsTable";

import type { PathRow } from "./types";

const FileWatchPathsTable: React.FC<{
  paths: string[];
  onChange: (paths: string[]) => void;
}> = ({ paths, onChange }) => {
  const { t } = useTranslation("integrations");
  const [newPath, setNewPath] = useState<string | null>(null);

  const rows: PathRow[] = useMemo(
    () => paths.map((filePath, idx) => ({ idx, path: filePath })),
    [paths]
  );

  const columns = useMemo<SettingsTableColumn<PathRow>[]>(
    () => [
      {
        key: "path",
        label: t("agentOrgs.filePathPlaceholder"),
        width: SETTINGS_TABLE_COL.fill,
        renderCell: (row) => <span className="text-text-2">{row.path}</span>,
      },
      {
        key: "actions",
        label: "",
        width: SETTINGS_TABLE_COL.hug,
        align: "right" as const,
        renderCell: (row) => (
          <Button
            variant="secondary"
            size="default"
            icon={<Trash2 size={14} className="text-danger-6" />}
            onClick={() => onChange(paths.filter((_, idx) => idx !== row.idx))}
            iconOnly
          />
        ),
      },
    ],
    [t, paths, onChange]
  );

  const handleAdd = useCallback(() => {
    if (!newPath?.trim()) return;
    onChange([...paths, newPath.trim()]);
    setNewPath(null);
  }, [newPath, paths, onChange]);

  const footer =
    newPath !== null ? (
      <div className="flex w-full items-center gap-2 px-0 py-2">
        <Input
          value={newPath}
          onChange={(val) => setNewPath(val)}
          placeholder={t("agentOrgs.filePathPlaceholder")}
          className="flex-1"
          size="default"
          autoFocus
        />
        <Button
          variant="secondary"
          size="default"
          onClick={handleAdd}
          disabled={!newPath.trim()}
        >
          {t("common:actions.save")}
        </Button>
        <Button size="default" onClick={() => setNewPath(null)}>
          {t("common:actions.cancel")}
        </Button>
      </div>
    ) : (
      <SettingsTableAddFooter
        noPx
        label={t("common:actions.add")}
        onClick={() => setNewPath("")}
      />
    );

  return (
    <SettingsTable<PathRow>
      columns={columns}
      rows={rows}
      getRowKey={(row) => `${row.idx}-${row.path}`}
      dense
      noPx
      footer={footer}
      emptyTitle={t("agentOrgs.filePathPlaceholder")}
    />
  );
};

export default FileWatchPathsTable;
