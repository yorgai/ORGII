import { createContext } from "react";

import type { MaterialThickness } from "@src/components/Glass/config";

/** Default when no provider (e.g. tests). */
export const SpotlightFooterMaterialContext =
  createContext<MaterialThickness>("thin");
