import { type MutableRefObject, useCallback, useRef, useState } from "react";

import type { BonusInfo } from "./resolveKeys";

export interface UseBonusAcceptanceReturn {
  acceptBonus: () => void;
  bonusResolverRef: MutableRefObject<((accepted: boolean) => void) | null>;
  declineBonus: () => void;
  pendingBonusInfo: BonusInfo | null;
  setPendingBonusInfo: (info: BonusInfo | null) => void;
}

export function useBonusAcceptance(): UseBonusAcceptanceReturn {
  const [pendingBonusInfo, setPendingBonusInfo] = useState<BonusInfo | null>(
    null
  );
  const bonusResolverRef = useRef<((accepted: boolean) => void) | null>(null);

  const acceptBonus = useCallback(() => {
    bonusResolverRef.current?.(true);
    bonusResolverRef.current = null;
    setPendingBonusInfo(null);
  }, []);

  const declineBonus = useCallback(() => {
    bonusResolverRef.current?.(false);
    bonusResolverRef.current = null;
    setPendingBonusInfo(null);
  }, []);

  return {
    acceptBonus,
    bonusResolverRef,
    declineBonus,
    pendingBonusInfo,
    setPendingBonusInfo,
  };
}
