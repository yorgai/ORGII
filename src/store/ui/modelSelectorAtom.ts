/**
 * Model Selector Atom
 *
 * Global state for the UnifiedModelPalette popup (model pill).
 * Lifted from local component state so that the selector survives
 * parent re-mounts (e.g. when the edit-mode layout changes) and so
 * that the ChatPanel InputArea ModelPill and SessionCreator ControlButtons
 * share a single open/close instance.
 */
import { atom } from "jotai";

export interface ModelSelectorState {
  isOpen: boolean;
}

const INITIAL: ModelSelectorState = {
  isOpen: false,
};

export const modelSelectorAtom = atom<ModelSelectorState>(INITIAL);
modelSelectorAtom.debugLabel = "modelSelectorAtom";
