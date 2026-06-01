import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Select from "@src/components/Select";
import type { SelectOption } from "@src/components/Select";
import type { EventVariant } from "@src/engines/SessionCore/rendering/types/universalProps";
import SimulatorFrame from "@src/engines/Simulator/components/SimulatorFrame";
import type { MockChatItem } from "@src/modules/MainApp/ToolPreview/mockData/scenarios";
import MessageViewer from "@src/modules/WorkStation/Chat/Communication/MessageViewer";
import type { MessageEntry } from "@src/modules/WorkStation/Chat/Communication/types";
import { convertToMessageEntry } from "@src/modules/WorkStation/Chat/Communication/utils";

import { ChatPreviewShell } from "../panels";
import { playgroundChatMessageEntry } from "../shared";
import { EventRenderer } from "./EventRenderer";

function scenarioItemsToMessages(items: MockChatItem[]): MessageEntry[] {
  const messages: MessageEntry[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];

    if (item.type === "user" || item.type === "agent") {
      messages.push(
        playgroundChatMessageEntry(
          `playground-session-${idx}`,
          item.type === "user" ? "user" : "agent",
          item.content ?? ""
        )
      );
    } else if (item.type === "activity" && item.eventData) {
      messages.push(convertToMessageEntry(item.eventData, "chat", false));
    }
  }
  return messages;
}

function SessionChatPreview({ items }: { items: MockChatItem[] }) {
  const messages = useMemo(() => scenarioItemsToMessages(items), [items]);

  return (
    <ChatPreviewShell>
      <MessageViewer messages={messages} viewMode="chat" />
    </ChatPreviewShell>
  );
}

function SessionSimulatorPreview({ items }: { items: MockChatItem[] }) {
  const renderedItems = useMemo(() => {
    return items.map((item, index) => {
      if (item.type === "user" || item.type === "agent") {
        return null;
      }

      if (item.type === "activity" && item.eventData) {
        return (
          <div key={`act-${index}`} className="min-w-0">
            <EventRenderer event={item.eventData} variant="simulator" />
          </div>
        );
      }

      return null;
    });
  }, [items]);

  return (
    <SimulatorFrame
      title=""
      radius={20}
      showHeader={false}
      containerClassName="tool-event-preview-simulator-frame"
      contentClassName="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {renderedItems}
      </div>
    </SimulatorFrame>
  );
}

interface SessionVariantPreviewProps {
  variant: EventVariant;
  items: MockChatItem[];
}

export function SessionVariantPreview({
  variant,
  items,
}: SessionVariantPreviewProps) {
  return variant === "simulator" ? (
    <SessionSimulatorPreview items={items} />
  ) : (
    <SessionChatPreview items={items} />
  );
}

interface LiveScenarioControlsProps {
  liveInput: string;
  liveItemsLength: number;
  isLiveResponding: boolean;
  onLiveInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onLiveInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onLiveSend: () => void;
  onLiveClear: () => void;
}

export function LiveScenarioControls({
  liveInput,
  liveItemsLength,
  isLiveResponding,
  onLiveInputChange,
  onLiveInputKeyDown,
  onLiveSend,
  onLiveClear,
}: LiveScenarioControlsProps) {
  const { t } = useTranslation(["integrations", "common"]);

  return (
    <div className="tool-event-live-input">
      <textarea
        className="tool-event-editor-textarea tool-event-live-input__textarea"
        value={liveInput}
        onChange={onLiveInputChange}
        onKeyDown={onLiveInputKeyDown}
        placeholder={t("devTools.activityDataPlaceholder")}
        spellCheck={false}
        disabled={isLiveResponding}
      />
      <div className="tool-event-live-input__actions">
        <Button
          size="small"
          onClick={onLiveClear}
          disabled={liveItemsLength === 0 && !isLiveResponding}
        >
          {t("actions.clear", { ns: "common" })}
        </Button>
        <Button
          variant="primary"
          size="small"
          onClick={onLiveSend}
          disabled={!liveInput.trim() || isLiveResponding}
        >
          {isLiveResponding
            ? t("devTools.statusRunning")
            : t("actions.submit", { ns: "common" })}
        </Button>
      </div>
    </div>
  );
}

interface LiveScriptEditorProps {
  selectedScriptPresetId: string;
  scriptPresetOptions: SelectOption[];
  flowScriptInput: string;
  flowScriptError: string | null;
  onScriptPresetChange: (value: string | number | (string | number)[]) => void;
  onFlowScriptInputChange: (
    event: React.ChangeEvent<HTMLTextAreaElement>
  ) => void;
  onFlowScriptReset: () => void;
}

export function LiveScriptEditor({
  selectedScriptPresetId,
  scriptPresetOptions,
  flowScriptInput,
  flowScriptError,
  onScriptPresetChange,
  onFlowScriptInputChange,
  onFlowScriptReset,
}: LiveScriptEditorProps) {
  const { t } = useTranslation(["integrations", "common"]);

  return (
    <div className="tool-event-live-script">
      <div className="tool-event-live-script__header">
        <div className="tool-event-field">
          <label className="tool-event-field-label">
            {t("devTools.activityData")}
          </label>
          <Select
            value={selectedScriptPresetId}
            options={scriptPresetOptions}
            onChange={onScriptPresetChange}
            size="small"
            className="tool-event-select"
          />
        </div>
      </div>
      <textarea
        className="tool-event-editor-textarea tool-event-live-script__textarea"
        value={flowScriptInput}
        onChange={onFlowScriptInputChange}
        placeholder={t("devTools.activityDataPlaceholder")}
        spellCheck={false}
      />
      {flowScriptError ? (
        <div className="tool-event-preview-error">
          {t("devTools.jsonParseError")}: {flowScriptError}
        </div>
      ) : null}
      <div className="tool-event-live-input__actions">
        <Button size="small" onClick={onFlowScriptReset}>
          {t("actions.reset", { ns: "common" })}
        </Button>
      </div>
    </div>
  );
}
