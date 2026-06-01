/**
 * Mobile Remote Control Settings Section
 *
 * Real surface that:
 *  - lists paired devices (label, tier, primary badge, last seen)
 *  - opens a wizard dialog to pair a new mobile device via QR + SAS
 *  - lets the user revoke or promote a device
 *  - reads + writes the relay URL via `getRelayUrl` / `setRelayUrl`
 *    (mirrors the Git-Proxy edit pattern in `NetworkSection.tsx`)
 *
 * Gated by `mobileRemoteEnabledAtom` for the device list, but the
 * relay URL is always rendered so the user can configure where to
 * pair against before any device exists.
 */
import {
  SECTION_GAP_CLASSES,
  SectionContainer,
  SectionRow,
} from "@/src/modules/shared/layouts/SectionLayout";
import { Placeholder } from "@/src/modules/shared/layouts/blocks";
import { useAtom } from "jotai";
import { Pencil, Plus, RotateCcw, Save, Smartphone, X } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type PairedDeviceInfo,
  type RelayUrlInfo,
  getRelayUrl as getRelayUrlCmd,
  listDevices,
  revokeDevice as revokeDeviceCmd,
  setPrimaryDesktop as setPrimaryDesktopCmd,
  setRelayUrl as setRelayUrlCmd,
} from "@src/api/tauri/mobileRemote";
import Button from "@src/components/Button";
import InlineAlert from "@src/components/InlineAlert";
import Input from "@src/components/Input";
import Switch from "@src/components/Switch";
import { mobileRemoteEnabledAtom } from "@src/store/ui/mobileRemoteAtom";

import { PairedDevicesList, PairingDialog } from "./MobileRemote";
import { RelayHostingPicker } from "./MobileRemote/Hosting";

/**
 * Validate a user-entered relay URL. Empty strings are accepted as
 * "reset to default"; non-empty values must parse as `http(s)://` URLs.
 * The relay protocol upgrades to `wss://` internally — see
 * `src-tauri/src/api/mobile_remote/relay_client/ws.rs` — so the user
 * supplies the HTTP form just like every other API base URL in the
 * settings UI.
 */
const isValidRelayUrl = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const MobileRemoteSection: React.FC = () => {
  const { t } = useTranslation("settings");
  const [enabled, setEnabled] = useAtom(mobileRemoteEnabledAtom);

  const [devices, setDevices] = useState<PairedDeviceInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [pairingOpen, setPairingOpen] = useState<boolean>(false);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [relayInfo, setRelayInfo] = useState<RelayUrlInfo | null>(null);
  const [relayEditing, setRelayEditing] = useState<boolean>(false);
  const [relayDraft, setRelayDraft] = useState<string>("");
  const [relaySaving, setRelaySaving] = useState<boolean>(false);
  const [relayError, setRelayError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    setLoading(true);
    try {
      const next = await listDevices();
      setDevices(next);
      setErrorMessage(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await listDevices();
        if (cancelled) return;
        setDevices(next);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const handlePairClick = useCallback(() => {
    setErrorMessage(null);
    setPairingOpen(true);
  }, []);

  const handlePairingClose = useCallback(() => {
    setPairingOpen(false);
    void refreshDevices();
  }, [refreshDevices]);

  const handlePaired = useCallback((device: PairedDeviceInfo) => {
    setDevices((prev) => {
      if (prev.some((existing) => existing.deviceId === device.deviceId)) {
        return prev;
      }
      return [...prev, device];
    });
  }, []);

  const handleRevoke = useCallback(async (deviceId: string) => {
    setBusyDeviceId(deviceId);
    setErrorMessage(null);
    try {
      await revokeDeviceCmd(deviceId);
      setDevices((prev) => prev.filter((dev) => dev.deviceId !== deviceId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
    } finally {
      setBusyDeviceId(null);
    }
  }, []);

  const handleSetPrimary = useCallback(
    async (device: PairedDeviceInfo) => {
      setBusyDeviceId(device.deviceId);
      setErrorMessage(null);
      try {
        await setPrimaryDesktopCmd(device.desktopId);
        await refreshDevices();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
      } finally {
        setBusyDeviceId(null);
      }
    },
    [refreshDevices]
  );

  // Load the persisted relay URL once the section is enabled. The
  // read is gated on `enabled` because (a) the relay URL is only ever
  // displayed when the toggle is on, so loading it eagerly is wasted
  // work, and (b) the read goes through a Tauri command that errors
  // when the desktop relay subsystem isn't initialized — surfacing
  // that error in a section the user has explicitly disabled is bad UX.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await getRelayUrlCmd();
        if (cancelled) return;
        setRelayInfo(next);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setRelayError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const handleRelayEdit = useCallback(() => {
    if (relayInfo === null) return;
    setRelayDraft(relayInfo.isDefault ? "" : relayInfo.url);
    setRelayError(null);
    setRelayEditing(true);
  }, [relayInfo]);

  const handleRelayCancel = useCallback(() => {
    setRelayEditing(false);
    setRelayDraft("");
    setRelayError(null);
  }, []);

  const handleRelaySave = useCallback(async () => {
    if (!isValidRelayUrl(relayDraft)) {
      setRelayError(t("mobileRemote.relayUrl.invalidUrl"));
      return;
    }
    setRelaySaving(true);
    setRelayError(null);
    try {
      await setRelayUrlCmd(relayDraft.trim());
      const next = await getRelayUrlCmd();
      setRelayInfo(next);
      setRelayEditing(false);
      setRelayDraft("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRelayError(message);
    } finally {
      setRelaySaving(false);
    }
  }, [relayDraft, t]);

  const handleRelayReset = useCallback(async () => {
    setRelaySaving(true);
    setRelayError(null);
    try {
      await setRelayUrlCmd("");
      const next = await getRelayUrlCmd();
      setRelayInfo(next);
      setRelayEditing(false);
      setRelayDraft("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRelayError(message);
    } finally {
      setRelaySaving(false);
    }
  }, []);

  const hasDevices = devices.length > 0;

  return (
    <div className={SECTION_GAP_CLASSES}>
      <SectionContainer>
        <SectionRow label={t("mobileRemote.title")}>
          <Switch checked={enabled} onChange={setEnabled} />
        </SectionRow>
      </SectionContainer>

      {enabled && (
        <>
          <SectionContainer>
            {errorMessage && (
              <SectionRow label="" showHeader={false}>
                <InlineAlert
                  type="danger"
                  title={t("mobileRemote.errors.unknown")}
                >
                  {errorMessage}
                </InlineAlert>
              </SectionRow>
            )}

            {hasDevices ? (
              <>
                <SectionRow label={t("mobileRemote.pairedListTitle")}>
                  <Button
                    variant="primary"
                    size="small"
                    icon={<Plus size={14} />}
                    onClick={handlePairClick}
                  >
                    {t("mobileRemote.pairButton")}
                  </Button>
                </SectionRow>
                <SectionRow label="" indent showHeader={false}>
                  <PairedDevicesList
                    devices={devices}
                    onRevoke={handleRevoke}
                    onSetPrimary={handleSetPrimary}
                    busyDeviceId={busyDeviceId}
                  />
                </SectionRow>
              </>
            ) : (
              <SectionRow label="" showHeader={false}>
                <Placeholder
                  variant="empty"
                  placement="detail-panel"
                  icon={<Smartphone size={28} className="text-text-3" />}
                  title={t("mobileRemote.emptyState.title")}
                  subtitle={t("mobileRemote.emptyState.body")}
                  action={{
                    label: t("mobileRemote.pairButton"),
                    onClick: handlePairClick,
                    variant: "primary",
                  }}
                />
              </SectionRow>
            )}
          </SectionContainer>

          <SectionContainer>
            <RelayHostingPicker />
          </SectionContainer>

          <SectionContainer>
            <SectionRow
              label={t("mobileRemote.relayUrl.label")}
              description={
                relayEditing
                  ? t("mobileRemote.relayUrl.helperText")
                  : relayInfo === null
                    ? t("common:status.loading")
                    : relayInfo.isDefault
                      ? t("mobileRemote.relayUrl.default", {
                          url: relayInfo.url,
                        })
                      : t("mobileRemote.relayUrl.custom", {
                          url: relayInfo.url,
                        })
              }
            >
              <div className="flex items-center gap-2">
                {!relayEditing && (
                  <Button
                    icon={<Pencil size={14} />}
                    iconOnly
                    onClick={handleRelayEdit}
                    disabled={relayInfo === null}
                    title={t("mobileRemote.relayUrl.edit")}
                  />
                )}
                {relayEditing && (
                  <>
                    <Button
                      variant="primary"
                      icon={<Save size={14} />}
                      iconOnly
                      onClick={handleRelaySave}
                      loading={relaySaving}
                      title={t("common:actions.save")}
                    />
                    <Button
                      icon={<X size={14} />}
                      iconOnly
                      onClick={handleRelayCancel}
                      disabled={relaySaving}
                      title={t("common:actions.cancel")}
                    />
                  </>
                )}
              </div>
            </SectionRow>

            {relayEditing && (
              <SectionRow label="" indent showHeader={false}>
                <div className="flex flex-col gap-2">
                  <Input
                    value={relayDraft}
                    onChange={setRelayDraft}
                    placeholder={t("mobileRemote.relayUrl.placeholder")}
                    className="w-full"
                    disabled={relaySaving}
                    error={relayError !== null}
                  />
                  {relayError && (
                    <span className="text-xs text-danger-6">{relayError}</span>
                  )}
                  {relayInfo && !relayInfo.isDefault && (
                    <Button
                      icon={<RotateCcw size={12} />}
                      onClick={handleRelayReset}
                      loading={relaySaving}
                      className="self-start"
                    >
                      {t("mobileRemote.relayUrl.reset")}
                    </Button>
                  )}
                </div>
              </SectionRow>
            )}
          </SectionContainer>
        </>
      )}

      <PairingDialog
        visible={pairingOpen}
        onClose={handlePairingClose}
        knownDevices={devices}
        onPaired={handlePaired}
      />
      {/* Surface the loading flag visually only when relevant. */}
      {loading && <span className="sr-only">{t("common:status.loading")}</span>}
    </div>
  );
};

export default MobileRemoteSection;
