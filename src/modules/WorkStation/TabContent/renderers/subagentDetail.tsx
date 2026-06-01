/**
 * Renderer wrapper for `subagent-detail` tabs.
 *
 * `SubagentDetailTab` is self-contained: it accepts only the `data`
 * blob carried by the tab (description, subagent type, optional session
 * id + result content). No host context required.
 */
import React, { memo } from "react";

import SubagentDetailTab from "@src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/SubagentDetailTab";
import type { SubagentDetailTabData } from "@src/store/workstation/tabs/types";

import type { UnifiedTabContentProps } from "../types";

const SubagentDetailTabRenderer: React.FC<UnifiedTabContentProps> = memo(
  ({ tab }) => (
    <SubagentDetailTab data={tab.data as unknown as SubagentDetailTabData} />
  )
);

SubagentDetailTabRenderer.displayName = "SubagentDetailTabRenderer";

export default SubagentDetailTabRenderer;
