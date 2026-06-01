/**
 * DeviceCard
 *
 * One row in the paired-devices list. Shows label, tier, primary
 * badge, last-seen relative time, and per-row actions (set primary /
 * revoke). The action handlers come from the parent so the card stays
 * a pure rendering component.
 */
import { Smartphone, Trash2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import {
  PERMISSION_TIER,
  type PairedDeviceInfo,
} from "@src/api/tauri/mobileRemote";
import Button from "@src/components/Button";

interface DeviceCardProps {
  device: PairedDeviceInfo;
  onRevoke: (deviceId: string) => void;
  /**
   * Promote the desktop this device is paired to. The handler receives
   * the full record so the parent can target the desktop while keeping
   * per-row busy state keyed by `deviceId`.
   */
  onSetPrimary?: (device: PairedDeviceInfo) => void;
  /** Disables both action buttons while a mutation is in flight. */
  busy?: boolean;
}

function formatLastSeen(
  lastSeenMs: number | null,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (lastSeenMs === null) {
    return t("mobileRemote.deviceCard.never");
  }
  const diffSec = Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000));
  if (diffSec < 60) {
    return t("mobileRemote.deviceCard.lastSeen", {
      relativeTime: t("mobileRemote.relativeTime.justNow"),
    });
  }
  if (diffSec < 3600) {
    return t("mobileRemote.deviceCard.lastSeen", {
      relativeTime: t("mobileRemote.relativeTime.minutesAgo", {
        count: Math.floor(diffSec / 60),
      }),
    });
  }
  if (diffSec < 86_400) {
    return t("mobileRemote.deviceCard.lastSeen", {
      relativeTime: t("mobileRemote.relativeTime.hoursAgo", {
        count: Math.floor(diffSec / 3600),
      }),
    });
  }
  return t("mobileRemote.deviceCard.lastSeen", {
    relativeTime: t("mobileRemote.relativeTime.daysAgo", {
      count: Math.floor(diffSec / 86_400),
    }),
  });
}

const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  onRevoke,
  onSetPrimary,
  busy = false,
}) => {
  const { t } = useTranslation("settings");

  const tierLabel =
    device.tier === PERMISSION_TIER.FULL
      ? t("mobileRemote.tier.fullControl")
      : t("mobileRemote.tier.readOnly");

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-2 bg-surface-container px-3 py-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-fill-2 text-text-2">
        <Smartphone size={18} />
      </div>

      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-1">
            {device.label}
          </span>
          {device.isPrimary && (
            <span className="inline-flex items-center rounded-full bg-primary-1 px-2 py-0.5 text-[11px] text-primary-6">
              {t("mobileRemote.deviceCard.primaryBadge")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-text-3">
          <span>{tierLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{formatLastSeen(device.lastSeenMs, t)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!device.isPrimary && onSetPrimary && (
          <Button
            variant="secondary"
            size="small"
            onClick={() => onSetPrimary(device)}
            disabled={busy}
          >
            {t("mobileRemote.deviceCard.setPrimary")}
          </Button>
        )}
        <Button
          variant="danger"
          appearance="ghost"
          size="small"
          icon={<Trash2 size={14} />}
          onClick={() => onRevoke(device.deviceId)}
          disabled={busy}
        >
          {t("mobileRemote.deviceCard.revoke")}
        </Button>
      </div>
    </div>
  );
};

export default DeviceCard;
