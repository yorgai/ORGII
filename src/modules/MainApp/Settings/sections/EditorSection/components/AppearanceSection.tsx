/**
 * Appearance Settings Section
 *
 * Font family, font size, line height, tab size, and editor feature toggles
 * (line numbers, word wrap, minimap, etc.)
 */
import {
  SECTION_CONTROL_STYLE,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { useAtom } from "jotai";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Input from "@src/components/Input";
import NumberInput from "@src/components/NumberInput";
import Select from "@src/components/Select";
import Switch from "@src/components/Switch";
import {
  CODE_FONT_FAMILIES,
  type CodeFontFamily,
  type EditorFontSize,
  type EditorLineHeight,
  type EditorLineNumbers,
  type EditorTabSize,
  codeFontFamilyAtom,
  customCodeFontFamilyAtom,
  editorAutoSaveAtom,
  editorFontSizeAtom,
  editorHighlightActiveLineAtom,
  editorLineHeightAtom,
  editorLineNumbersAtom,
  editorShowIndentGuidesAtom,
  editorShowMinimapAtom,
  editorTabSizeAtom,
  editorWordWrapAtom,
} from "@src/store/ui/editorSettingsAtom";
import { terminalFontSizeAtom } from "@src/store/ui/uiAtom";

const CUSTOM_FONT_DEBOUNCE_MS = 3000;

const AppearanceSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");

  const [codeFontFamily, setCodeFontFamily] = useAtom(codeFontFamilyAtom);
  const [customFontFamily, setCustomFontFamily] = useAtom(
    customCodeFontFamilyAtom
  );

  // Appearance atoms
  const [fontSize, setFontSize] = useAtom(editorFontSizeAtom);
  const [tabSize, setTabSize] = useAtom(editorTabSizeAtom);
  const [lineHeight, setLineHeight] = useAtom(editorLineHeightAtom);
  const [terminalFontSize, setTerminalFontSize] = useAtom(terminalFontSizeAtom);
  const [lineNumbers, setLineNumbers] = useAtom(editorLineNumbersAtom);
  const [wordWrap, setWordWrap] = useAtom(editorWordWrapAtom);
  const [autoSave, setAutoSave] = useAtom(editorAutoSaveAtom);
  const [showMinimap, setShowMinimap] = useAtom(editorShowMinimapAtom);
  const [showIndentGuides, setShowIndentGuides] = useAtom(
    editorShowIndentGuidesAtom
  );
  const [highlightActiveLine, setHighlightActiveLine] = useAtom(
    editorHighlightActiveLineAtom
  );

  // Local state for custom font name with debounce
  const [localCustomFont, setLocalCustomFont] = useState(customFontFamily);
  const customFontDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  useEffect(() => {
    setLocalCustomFont(customFontFamily);
  }, [customFontFamily]);

  useEffect(() => {
    if (localCustomFont === customFontFamily) return;

    if (customFontDebounceRef.current) {
      clearTimeout(customFontDebounceRef.current);
    }

    customFontDebounceRef.current = setTimeout(() => {
      setCustomFontFamily(localCustomFont);
    }, CUSTOM_FONT_DEBOUNCE_MS);

    return () => {
      if (customFontDebounceRef.current) {
        clearTimeout(customFontDebounceRef.current);
      }
    };
  }, [localCustomFont, customFontFamily, setCustomFontFamily]);

  // Handlers
  const handleFontFamilyChange = useCallback(
    (value: string | number | (string | number)[]) => {
      const fontValue = typeof value === "string" ? value : String(value);
      setCodeFontFamily(fontValue as CodeFontFamily);
    },
    [setCodeFontFamily]
  );

  const handleLineNumbersChange = useCallback(
    (value: string | number | (string | number)[]) => {
      const mode = typeof value === "string" ? value : String(value);
      setLineNumbers(mode as EditorLineNumbers);
    },
    [setLineNumbers]
  );

  const lineNumbersOptions = useMemo(
    () => [
      { value: "on", label: t("common:common.on") },
      { value: "off", label: t("common:common.off") },
      { value: "relative", label: t("editor.lineNumbersRelative") },
      { value: "interval", label: t("editor.lineNumbersInterval") },
    ],
    [t]
  );
  return (
    <>
      <SectionContainer title={t("editor.appearance")}>
        <SectionRow label={t("editor.fontFamily")}>
          <Select
            value={codeFontFamily}
            onChange={handleFontFamilyChange}
            options={CODE_FONT_FAMILIES}
            showSearch
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>

        {codeFontFamily === "custom" && (
          <SectionRow label={t("editor.customFontName")} indent>
            <Input
              value={localCustomFont}
              onChange={setLocalCustomFont}
              placeholder="Fira Code"
              style={SECTION_CONTROL_STYLE}
            />
          </SectionRow>
        )}

        <SectionRow label={t("editor.fontSize")}>
          <NumberInput
            value={fontSize}
            min={10}
            max={24}
            step={1}
            suffix={tCommon("common.px")}
            controlsPosition="sides"
            onChange={(value) => setFontSize((value ?? 13) as EditorFontSize)}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>

        <SectionRow label={t("editor.lineHeight")}>
          <NumberInput
            value={lineHeight}
            min={1.2}
            max={2.0}
            step={0.1}
            suffix={tCommon("common.multiplier")}
            controlsPosition="sides"
            onChange={(value) =>
              setLineHeight((value ?? 1.5) as EditorLineHeight)
            }
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>

        <SectionRow label={t("editor.tabSize")}>
          <NumberInput
            value={tabSize}
            min={2}
            max={8}
            step={2}
            suffix={tCommon("common.spaces")}
            controlsPosition="sides"
            onChange={(value) => setTabSize((value ?? 2) as EditorTabSize)}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </SectionContainer>

      <SectionContainer title={t("common:tabs.terminal")}>
        <SectionRow label={t("editor.terminalFontSize")}>
          <NumberInput
            value={terminalFontSize}
            min={8}
            max={32}
            step={1}
            suffix={tCommon("common.px")}
            controlsPosition="sides"
            onChange={(value) => setTerminalFontSize(value ?? 13)}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>
      </SectionContainer>

      {/* Editor Features */}
      <SectionContainer>
        <SectionRow label={t("editor.lineNumbers")}>
          <Select
            value={lineNumbers}
            onChange={handleLineNumbersChange}
            options={lineNumbersOptions}
            style={SECTION_CONTROL_STYLE}
          />
        </SectionRow>

        <SectionRow label={t("editor.wordWrap")}>
          <Switch checked={wordWrap} onChange={setWordWrap} />
        </SectionRow>

        <SectionRow label={t("editor.autoSave")}>
          <Switch checked={autoSave} onChange={setAutoSave} />
        </SectionRow>

        <SectionRow label={t("editor.minimap")}>
          <Switch checked={showMinimap} onChange={setShowMinimap} />
        </SectionRow>

        <SectionRow label={t("editor.indentGuides")}>
          <Switch checked={showIndentGuides} onChange={setShowIndentGuides} />
        </SectionRow>

        <SectionRow label={t("editor.highlightActiveLine")}>
          <Switch
            checked={highlightActiveLine}
            onChange={setHighlightActiveLine}
          />
        </SectionRow>
      </SectionContainer>
    </>
  );
};

export default AppearanceSection;
