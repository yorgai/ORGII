/**
 * External IDE Settings Section
 *
 * IDE detection and preferred external editor configuration.
 */
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { useAtom } from "jotai";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { detectIDEs } from "@src/api/tauri/repo";
import DropdownFooter from "@src/components/Dropdown/DropdownFooter";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import Message from "@src/components/Message";
import Select from "@src/components/Select";
import { createLogger } from "@src/hooks/logger";
import { preferIDEAtom } from "@src/store/config/configAtom";

const log = createLogger("ExternalIdeSection");

interface IdeItem {
  name: string;
  path: string;
  category?: "ide" | "ai_cli";
}

interface IdeListResponse {
  data: {
    ides: IdeItem[];
    preferred_ide?: string;
  };
  status: number;
}

const AVAILABLE_IDES_STORAGE_KEY = "orgii_available_external_ides";

type RawIdeItem = IdeItem | string | Record<string, unknown> | null | undefined;

const normalizeIdeList = (ides: RawIdeItem[]): IdeItem[] => {
  if (!Array.isArray(ides)) {
    return [];
  }

  return ides
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") return { name: item, path: "" };
      if (typeof item === "object") {
        const name = typeof item.name === "string" ? item.name : undefined;
        const path = typeof item.path === "string" ? item.path : "";
        const category =
          typeof item.category === "string"
            ? (item.category as "ide" | "ai_cli")
            : undefined;
        if (name) return { name, path, category };
      }
      return null;
    })
    .filter((item): item is IdeItem => Boolean(item));
};

const persistIdeList = (list: RawIdeItem[]) => {
  const normalized = normalizeIdeList(list);
  localStorage.setItem(AVAILABLE_IDES_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event("localStorageChange"));
};

const ExternalIdeSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation();
  const [ideOptions, setIdeOptions] = useState<IdeItem[]>([]);
  const [preferredExternalIde, setPreferredExternalIde] =
    useAtom(preferIDEAtom);
  const [isDetectingIde, setIsDetectingIde] = useState(false);

  useEffect(() => {
    try {
      const storedIdeList = localStorage.getItem(AVAILABLE_IDES_STORAGE_KEY);
      if (storedIdeList) {
        const parsed = JSON.parse(storedIdeList) as RawIdeItem[];
        const normalized = normalizeIdeList(parsed);
        setIdeOptions(normalized);
      }
    } catch (error) {
      log.error("Failed to read stored IDE list", error);
    }
  }, []);

  const handlePreferredIdeChange = (
    value: string | number | (string | number)[]
  ) => {
    const ideValue = typeof value === "string" ? value : String(value);
    setPreferredExternalIde(ideValue);
  };

  const handleDetectIde = useCallback(async () => {
    setIsDetectingIde(true);
    try {
      const res = (await detectIDEs()) as unknown as IdeListResponse;
      if (res?.status === 0) {
        const rawIdes = (res.data?.ides as RawIdeItem[]) ?? [];
        const installedOnly = rawIdes.filter(
          (item) =>
            item &&
            typeof item === "object" &&
            "installed" in item &&
            (item as Record<string, unknown>).installed === true
        );
        const allDetected = normalizeIdeList(installedOnly);
        const normalizedIdes = allDetected.filter(
          (ide) => ide.category !== "ai_cli"
        );
        setIdeOptions(normalizedIdes);
        persistIdeList(normalizedIdes);

        const detectedPreferred =
          res.data?.preferred_ide || normalizedIdes[0]?.name || "";
        if (detectedPreferred) {
          setPreferredExternalIde(detectedPreferred);
        }
        Message.success(
          t("toasts.idesDetected", { count: normalizedIdes.length })
        );
      } else {
        Message.error(
          "Unable to detect IDEs. Please ensure your IDE is installed and try again."
        );
      }
    } catch (error) {
      log.error("Failed to detect IDEs", error);
      Message.error(t("toasts.ideDetectFailed"));
    } finally {
      setIsDetectingIde(false);
    }
  }, [setPreferredExternalIde, t]);

  const selectPlaceholder = isDetectingIde
    ? tCommon("actions.loading")
    : ideOptions.length
      ? t("editor.selectIde")
      : t("editor.runDetect");

  const ideDropdownRender = useCallback(
    (menu: React.ReactNode) => (
      <div className="flex min-h-0 flex-1 flex-col">
        {menu}
        <DropdownFooter>
          <button
            type="button"
            className={`${DROPDOWN_CLASSES.item} ${DROPDOWN_CLASSES.itemHover} w-full justify-start disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={isDetectingIde}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleDetectIde();
            }}
          >
            {isDetectingIde
              ? tCommon("actions.loading")
              : tCommon("actions.refresh")}
          </button>
        </DropdownFooter>
      </div>
    ),
    [handleDetectIde, isDetectingIde, tCommon]
  );

  return (
    <SectionContainer>
      <SectionRow
        label={t("editor.preferredExternalIde")}
        description={t("editor.preferredExternalIdeDesc")}
      >
        <Select
          placeholder={selectPlaceholder}
          value={preferredExternalIde || undefined}
          size="default"
          onChange={handlePreferredIdeChange}
          disabled={isDetectingIde}
          options={ideOptions.map((ide) => ({
            label: ide.name,
            value: ide.name,
          }))}
          style={SECTION_CONTROL_STYLE}
          dropdownRender={ideDropdownRender}
        />
      </SectionRow>
    </SectionContainer>
  );
};

export default ExternalIdeSection;
