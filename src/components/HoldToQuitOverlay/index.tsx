import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";

import { getShortcutKeys } from "@src/config/keyboard/shortcutDisplay";
import { holdToQuitOverlayOpenAtom } from "@src/store/ui/overlayAtom";

const HoldToQuitOverlay = () => {
  const isOpen = useAtomValue(holdToQuitOverlayOpenAtom);
  const { t } = useTranslation("common");
  const shortcut = getShortcutKeys("quit_app");

  if (!isOpen) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[10000] flex items-center justify-center">
      <div className="min-w-[280px] rounded-2xl border border-border-2 bg-bg-1/95 px-6 py-5 text-center shadow-2xl backdrop-blur-xl">
        <div className="text-[15px] font-semibold text-text-1">
          {t("holdToQuit.title", { shortcut })}
        </div>
        <div className="mt-1 text-[12px] text-text-3">
          {t("holdToQuit.subtitle")}
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-fill-2">
          <div className="h-full origin-left animate-[hold-to-quit-progress_1s_linear_forwards] rounded-full bg-primary-6" />
        </div>
      </div>
    </div>
  );
};

export default HoldToQuitOverlay;
