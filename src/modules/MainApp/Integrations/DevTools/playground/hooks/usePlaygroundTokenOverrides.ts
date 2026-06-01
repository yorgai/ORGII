import { useCallback, useMemo, useState } from "react";

import {
  computeTokenOverrides,
  generateOverrideStyles,
  getOverrideClassName,
} from "../panels";

export function usePlaygroundTokenOverrides() {
  const [fontSizePreset, setFontSizePreset] = useState<string>("default");
  const [spacingPreset, setSpacingPreset] = useState<string>("default");
  const [radiusPreset, setRadiusPreset] = useState<string>("default");

  const handleResetTokens = useCallback(() => {
    setFontSizePreset("default");
    setSpacingPreset("default");
    setRadiusPreset("default");
  }, []);

  const tokenOverrides = useMemo(
    () => computeTokenOverrides(fontSizePreset, spacingPreset, radiusPreset),
    [fontSizePreset, spacingPreset, radiusPreset]
  );
  const overrideStyles = useMemo(
    () => generateOverrideStyles(tokenOverrides),
    [tokenOverrides]
  );
  const overrideClassName = useMemo(
    () => getOverrideClassName(tokenOverrides),
    [tokenOverrides]
  );

  return {
    fontSizePreset,
    setFontSizePreset,
    spacingPreset,
    setSpacingPreset,
    radiusPreset,
    setRadiusPreset,
    handleResetTokens,
    overrideStyles,
    overrideClassName,
  };
}
