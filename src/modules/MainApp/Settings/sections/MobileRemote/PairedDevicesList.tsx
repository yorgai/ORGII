/**
 * PairedDevicesList
 *
 * Renders the list of paired mobile devices. The parent owns
 * fetching/mutation; this component is purely presentational.
 */
import React from "react";

import { type PairedDeviceInfo } from "@src/api/tauri/mobileRemote";

import DeviceCard from "./DeviceCard";

interface PairedDevicesListProps {
  devices: PairedDeviceInfo[];
  onRevoke: (deviceId: string) => void;
  onSetPrimary?: (device: PairedDeviceInfo) => void;
  busyDeviceId?: string | null;
}

const PairedDevicesList: React.FC<PairedDevicesListProps> = ({
  devices,
  onRevoke,
  onSetPrimary,
  busyDeviceId,
}) => {
  return (
    <div className="flex flex-col gap-2">
      {devices.map((device) => (
        <DeviceCard
          key={device.deviceId}
          device={device}
          onRevoke={onRevoke}
          onSetPrimary={onSetPrimary}
          busy={busyDeviceId === device.deviceId}
        />
      ))}
    </div>
  );
};

export default PairedDevicesList;
