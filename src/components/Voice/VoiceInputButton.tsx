/**
 * VoiceInputButton — microphone toggle that sits to the left of the Send
 * button in the composer toolbar.
 *
 * Idle: subtle round icon button matching the other toolbar controls
 * (matches the + button visual weight). Clicking starts dictation; the
 * recording UI is owned by `VoiceRecordingBar` which replaces the entire
 * toolbar row while capture is active.
 */
import { Mic } from "lucide-react";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";

import { KeyboardShortcutTooltipContent } from "@src/components/KeyboardShortcut";
import Tooltip from "@src/components/Tooltip";
import { INPUT_AREA_BUTTONS } from "@src/config/inputAreaTokens";
import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";

interface VoiceInputButtonProps {
  onStart: () => void;
  /**
   * If false the button is rendered as disabled (e.g. SpeechRecognition is
   * not available in this environment). The tooltip still surfaces the
   * reason so the user gets feedback on hover.
   */
  disabled?: boolean;
}

const VoiceInputButton: React.FC<VoiceInputButtonProps> = memo(
  ({ onStart, disabled = false }) => {
    const { t } = useTranslation();

    const buttonNode = (
      <button
        type="button"
        onClick={onStart}
        disabled={disabled}
        className={`${INPUT_AREA_BUTTONS.iconButtonBase} ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        } leading-none`}
        style={{ lineHeight: 0 }}
        data-testid="composer-voice-input-button"
        aria-label={t("common:tooltips.startVoiceInput")}
      >
        <Mic
          size={INPUT_AREA_BUTTONS.iconSize}
          strokeWidth={1.75}
          className="block"
        />
      </button>
    );

    return (
      <Tooltip
        content={
          <KeyboardShortcutTooltipContent
            label={t("common:tooltips.startVoiceInput")}
            shortcut={getShortcutKeys("voice_input")}
          />
        }
        position="top"
        mouseEnterDelay={200}
        framedPanel
      >
        {buttonNode}
      </Tooltip>
    );
  }
);

VoiceInputButton.displayName = "VoiceInputButton";

export default VoiceInputButton;
