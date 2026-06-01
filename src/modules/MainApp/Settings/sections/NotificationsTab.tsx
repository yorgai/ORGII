/**
 * Notifications Tab
 *
 * Renders the master enable toggle plus the advanced category / sound /
 * system / dock-badge / test-notification blocks. Lives as a tab inside
 * the General section (formerly a top-level Settings section).
 *
 * The two slot components below are also referenced by the row slot
 * registry — keeping the composition here means the tab body matches
 * exactly what the old standalone section rendered.
 */
import {
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import React from "react";
import { useTranslation } from "react-i18next";

import NotificationsAdvancedBlocks from "@src/modules/MainApp/Settings/renderer/slots/NotificationsAdvancedBlocks";
import NotificationsMasterToggleRow from "@src/modules/MainApp/Settings/renderer/slots/NotificationsMasterToggleRow";

const NotificationsTab: React.FC = () => {
  const { t } = useTranslation("settings");

  return (
    <>
      <SectionContainer>
        <SectionRow label={t("notifications.enable")}>
          <NotificationsMasterToggleRow />
        </SectionRow>
      </SectionContainer>
      <NotificationsAdvancedBlocks />
    </>
  );
};

export default NotificationsTab;
