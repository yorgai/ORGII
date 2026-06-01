import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  checkNotificationPermission,
  requestNotificationPermission,
} from "@src/api/services/notification";
import Message from "@src/components/Message";
import Switch from "@src/components/Switch";
import { useSetting } from "@src/store/settings";

const NotificationsMasterToggleRow: React.FC = () => {
  const { t } = useTranslation("settings");
  const [enabled, setEnabled] = useSetting("notifications.enabled");
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    checkNotificationPermission().then((status) => {
      if (!cancelled) {
        setPermissionStatus(status);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async () => {
    if (permissionStatus !== "granted") {
      const result = await requestNotificationPermission();
      setPermissionStatus(result);
      if (result === "granted") {
        Message.success(t("notifications.enabledSuccess"));
        setEnabled(true);
      } else {
        Message.warning(t("notifications.permissionDenied"));
      }
      return;
    }

    setEnabled(!enabled);
  };

  if (permissionStatus === null) {
    return <Switch checked={enabled} disabled />;
  }

  return (
    <Switch
      checked={enabled && permissionStatus === "granted"}
      onChange={handleToggle}
    />
  );
};

export default NotificationsMasterToggleRow;
