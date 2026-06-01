import { createContext } from "react";

import type { GitStatusContextValue } from "./types";

export const GitStatusContext = createContext<GitStatusContextValue>({
  statusMap: new Map(),
  folderStatusMap: new Map(),
  repoPath: null,
  isMultiRoot: false,
});
