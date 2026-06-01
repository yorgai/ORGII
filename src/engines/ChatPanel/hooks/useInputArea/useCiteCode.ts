/**
 * useCiteCode
 *
 * Manages cite code state and handlers for the InputArea
 */
import { useAtom } from "jotai";
import { useCallback } from "react";

import {
  curSelectFileNameAtom,
  isCiteCodeAtom,
  selectedCiteRangeAtom,
  selectedCiteTextAtom,
} from "@src/store/workstation/codeEditor/editor";

import type { CiteCodeSnapshot, CiteCodeState } from "./types";

export function useCiteCode(): CiteCodeState {
  const [isCiteCode, setIsCiteCode] = useAtom(isCiteCodeAtom);
  const [selectedCiteRange, setSelectedCiteRange] = useAtom(
    selectedCiteRangeAtom
  );
  const [selectedCiteText, setSelectedCiteText] = useAtom(selectedCiteTextAtom);
  const [citeFileName, setCiteFileName] = useAtom(curSelectFileNameAtom);

  const clearCiteCode = useCallback(() => {
    setIsCiteCode(false);
    setSelectedCiteRange(null);
    setSelectedCiteText("");
    setCiteFileName("");
  }, [
    setIsCiteCode,
    setSelectedCiteRange,
    setSelectedCiteText,
    setCiteFileName,
  ]);

  /**
   * Restore a previously-captured cite-code snapshot. Used by the
   * InputArea submit path to undo the optimistic clear if the outgoing
   * send fails — otherwise the citation banner would silently disappear
   * even though the message never left.
   */
  const restoreCiteCode = useCallback(
    (snapshot: CiteCodeSnapshot) => {
      setIsCiteCode(snapshot.isCiteCode);
      setSelectedCiteRange(snapshot.selectedCiteRange);
      setSelectedCiteText(snapshot.selectedCiteText);
      setCiteFileName(snapshot.citeFileName);
    },
    [setIsCiteCode, setSelectedCiteRange, setSelectedCiteText, setCiteFileName]
  );

  /**
   * Capture the current cite-code state for later restoration. Returned
   * by value so the caller is free to clear the live state immediately
   * after snapshotting without risking the snapshot drifting.
   */
  const captureCiteCode = useCallback((): CiteCodeSnapshot => {
    return {
      isCiteCode,
      selectedCiteRange,
      selectedCiteText,
      citeFileName,
    };
  }, [isCiteCode, selectedCiteRange, selectedCiteText, citeFileName]);

  return {
    isCiteCode,
    selectedCiteRange,
    selectedCiteText,
    citeFileName,
    clearCiteCode,
    restoreCiteCode,
    captureCiteCode,
  };
}
