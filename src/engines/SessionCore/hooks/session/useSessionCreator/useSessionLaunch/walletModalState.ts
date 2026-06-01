import { useCallback, useState } from "react";

export interface UseWalletModalStateReturn {
  closeAddFundsModal: () => void;
  closeBuyCreditsModal: () => void;
  setShowAddFundsModal: (show: boolean) => void;
  setShowBuyCreditsModal: (show: boolean) => void;
  showAddFundsModal: boolean;
  showBuyCreditsModal: boolean;
}

export function useWalletModalState(): UseWalletModalStateReturn {
  const [showAddFundsModal, setShowAddFundsModal] = useState(false);
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false);

  const closeAddFundsModal = useCallback(() => {
    setShowAddFundsModal(false);
  }, []);

  const closeBuyCreditsModal = useCallback(() => {
    setShowBuyCreditsModal(false);
  }, []);

  return {
    closeAddFundsModal,
    closeBuyCreditsModal,
    setShowAddFundsModal,
    setShowBuyCreditsModal,
    showAddFundsModal,
    showBuyCreditsModal,
  };
}
