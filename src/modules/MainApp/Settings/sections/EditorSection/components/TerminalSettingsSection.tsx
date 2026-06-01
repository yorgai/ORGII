/**
 * Terminal Settings Section
 *
 * Shell configuration for integrated terminals.
 */
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { useAtom } from "jotai";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import Message from "@src/components/Message";
import Select from "@src/components/Select";
import {
  type ShellType,
  customShellPathAtom,
  shellTypeAtom,
} from "@src/store/ui/editorSettingsAtom";

const CUSTOM_SHELL_DEBOUNCE_MS = 3000;

const TerminalSection: React.FC = () => {
  const { t } = useTranslation("settings");

  const [shellType, setShellType] = useAtom(shellTypeAtom);
  const [customShellPath, setCustomShellPath] = useAtom(customShellPathAtom);

  const [localCustomShellPath, setLocalCustomShellPath] =
    useState(customShellPath);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalCustomShellPath(customShellPath);
  }, [customShellPath]);

  useEffect(() => {
    if (localCustomShellPath === customShellPath) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setCustomShellPath(localCustomShellPath);
      if (shellType === "custom") {
        Message.success("Custom command updated");
      }
    }, CUSTOM_SHELL_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [localCustomShellPath, customShellPath, setCustomShellPath, shellType]);

  const handleShellTypeChange = useCallback(
    (value: ShellType) => {
      setShellType(value);
      Message.success("Shell setting updated");
    },
    [setShellType]
  );

  return (
    <SectionContainer title={t("common:tabs.terminal")}>
      <SectionRow
        label={t("editor.shellsOpenWith")}
        description={t("editor.shellsOpenWithDesc")}
      >
        <Select
          value={shellType}
          onChange={(value) => handleShellTypeChange(value as ShellType)}
          options={[
            { label: t("editor.repoPath"), value: "repo" },
            { label: t("editor.defaultLoginShell"), value: "default" },
            { label: t("editor.customShell"), value: "custom" },
          ]}
          style={SECTION_CONTROL_STYLE}
        />
      </SectionRow>
      {shellType === "custom" && (
        <SectionRow
          label={t("editor.customCommand")}
          description={t("editor.customCommandDesc")}
          indent
        >
          <Input
            value={localCustomShellPath}
            onChange={setLocalCustomShellPath}
            placeholder="/bin/zsh"
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      )}
    </SectionContainer>
  );
};

export default TerminalSection;
