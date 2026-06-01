// ============================================
// Type Definitions
// ============================================
import type { ApiCall } from "@src/util/monitoring/apiTracker";

export interface APICallPanelProps {
  visible: boolean;
  apiCalls: ApiCall[];
  onClose: () => void;
  onClear: () => void;
}
