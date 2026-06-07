import { z } from "zod";

import { ACTION_ID } from "@src/ActionSystem/actionIds";
import { defineAppActionRegistration } from "@src/ActionSystem/schema/actionRegistration";
import { defineZodAction } from "@src/ActionSystem/schema/defineZodAction";
import { showScaleMessage } from "@src/hooks/navigation/useGlobalShortcuts/types";
import { UI_SCALE_CONFIG, uiScaleAtom } from "@src/store/ui/uiAtom";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

const emptyParams = z.object({});

function setUiScale(nextScale: number): number {
  const store = getInstrumentedStore();
  store.set(uiScaleAtom, nextScale);
  const appliedScale = store.get(uiScaleAtom);
  showScaleMessage(appliedScale);
  return appliedScale;
}

const appZoomIn = defineZodAction(
  {
    id: ACTION_ID.APP_ZOOM_IN,
    category: "view",
    layer: "gui",
    description: "Increase the application UI scale",
    params: emptyParams,
    examples: ["zoom in", "increase UI scale"],
  },
  async () => {
    const store = getInstrumentedStore();
    const currentScale = store.get(uiScaleAtom);
    const nextScale = Math.min(
      UI_SCALE_CONFIG.MAX,
      currentScale + UI_SCALE_CONFIG.STEP
    );
    const appliedScale = setUiScale(nextScale);
    return { success: true, message: `UI scale set to ${appliedScale}%` };
  }
);

const appZoomOut = defineZodAction(
  {
    id: ACTION_ID.APP_ZOOM_OUT,
    category: "view",
    layer: "gui",
    description: "Decrease the application UI scale",
    params: emptyParams,
    examples: ["zoom out", "decrease UI scale"],
  },
  async () => {
    const store = getInstrumentedStore();
    const currentScale = store.get(uiScaleAtom);
    const nextScale = Math.max(
      UI_SCALE_CONFIG.MIN,
      currentScale - UI_SCALE_CONFIG.STEP
    );
    const appliedScale = setUiScale(nextScale);
    return { success: true, message: `UI scale set to ${appliedScale}%` };
  }
);

const appZoomReset = defineZodAction(
  {
    id: ACTION_ID.APP_ZOOM_RESET,
    category: "view",
    layer: "gui",
    description: "Reset the application UI scale to 100 percent",
    params: emptyParams,
    examples: ["reset zoom", "reset UI scale"],
  },
  async () => {
    const appliedScale = setUiScale(UI_SCALE_CONFIG.DEFAULT);
    return { success: true, message: `UI scale set to ${appliedScale}%` };
  }
);

export const appZoomZodActions = [appZoomIn, appZoomOut, appZoomReset];

export const appZoomActionRegistration =
  defineAppActionRegistration(appZoomZodActions);
