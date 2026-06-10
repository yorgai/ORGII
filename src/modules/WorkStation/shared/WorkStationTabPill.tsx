import React from "react";

import TabPill, { type TabPillProps } from "@src/components/TabPill";

import {
  WORK_STATION_TAB_PILL_SHARED_PROPS,
  WORK_STATION_TAB_PILL_TEXT_CLASS,
} from "./TabBar/components/WorkStationTabPillSurface/tokens";

export type WorkStationTabPillProps = TabPillProps;

export const WorkStationTabPill: React.FC<WorkStationTabPillProps> = ({
  textClassName,
  size = WORK_STATION_TAB_PILL_SHARED_PROPS.size,
  ...props
}) => (
  <TabPill
    {...props}
    size={size}
    textClassName={
      textClassName
        ? `${WORK_STATION_TAB_PILL_TEXT_CLASS} ${textClassName}`
        : WORK_STATION_TAB_PILL_TEXT_CLASS
    }
  />
);

WorkStationTabPill.displayName = "WorkStationTabPill";

export default WorkStationTabPill;
