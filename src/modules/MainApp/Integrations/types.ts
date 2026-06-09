import type { useChannelState } from "./hooks/useChannelState";

export {
  CATEGORY_KEYS,
  EXTENSION_TABLE_CATEGORIES,
  type ExtensionTableCategory,
  type IntegrationCategory,
  type SplitViewTableCategory,
  type DetailMode,
  type AddAction,
  type WizardKind,
} from "@src/api/types/integrations";

export type ChannelSlice = Pick<
  ReturnType<typeof useChannelState>,
  | "config"
  | "update"
  | "selectedChannel"
  | "channelWizardMode"
  | "channelWizardInitialSelection"
  | "selectedChannelPath"
  | "isSelectedChannelEnabled"
  | "selectedChannelStatus"
  | "channelProbing"
  | "channelProbeResult"
  | "existingAccountsMap"
  | "refreshProjectConnections"
  | "handleChannelWizardSubmit"
  | "handleChannelWizardCancel"
  | "handleProbeChannel"
  | "handleRemoveChannel"
  | "toggleChannelEnabled"
>;
