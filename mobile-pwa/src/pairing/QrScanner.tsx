// QR scanner for the desktop's pairing payload.
//
// The desktop renders a QR whose body is the JSON of
// `src-tauri/src/api/mobile_remote/pairing/qr_payload.rs::QrPayload`:
//
//   { relayUrl, pairingCode, desktopId, fingerprintHex }
//
// (camelCase keys — `#[serde(rename_all = "camelCase")]` on the
// Rust struct). This component:
//
//   1. Tries the native BarcodeDetector API (Chromium + iOS Safari
//      17+). On detection it parses the QR text as JSON, validates
//      the four fields, and emits via `onScanned`.
//   2. Falls back to a paste-JSON textarea on browsers without
//      BarcodeDetector. The textarea accepts the same QR payload
//      verbatim so testers can copy-paste from the desktop.
//
// Camera teardown happens on unmount and whenever the underlying
// `<video>` element is replaced. Permission errors and "no camera
// available" surface as inline messages — never as exceptions.
import { useCallback, useEffect, useRef, useState } from "react";

/** The four fields a valid QR payload must carry. The wire shape is
 * camelCase per the Rust QrPayload struct. */
export interface QrPayload {
  relayUrl: string;
  pairingCode: string;
  desktopId: string;
  fingerprintHex: string;
}

interface Props {
  onScanned: (payload: QrPayload) => void;
}

interface BarcodeDetectorResult {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<BarcodeDetectorResult[]>;
}

interface BarcodeDetectorConstructor {
  new (init: { formats: string[] }): BarcodeDetectorLike;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

const SCAN_INTERVAL_MS = 350;

function hasNativeBarcodeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/** Validate that `value` has all four required string fields of a
 * QrPayload. Extra fields are tolerated; missing or non-string
 * fields fail. */
function parseQrPayload(value: unknown): QrPayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (
    typeof obj.relayUrl !== "string" ||
    typeof obj.pairingCode !== "string" ||
    typeof obj.desktopId !== "string" ||
    typeof obj.fingerprintHex !== "string"
  ) {
    return null;
  }
  return {
    relayUrl: obj.relayUrl,
    pairingCode: obj.pairingCode,
    desktopId: obj.desktopId,
    fingerprintHex: obj.fingerprintHex,
  };
}

function tryParseQrText(raw: string): QrPayload | null {
  try {
    return parseQrPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function QrScanner({ onScanned }: Props): JSX.Element {
  const supported = hasNativeBarcodeDetector();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraError, setCameraError] = useState<string>("");
  const [pasted, setPasted] = useState<string>("");
  const [pasteError, setPasteError] = useState<string>("");

  // Stable callback ref so the camera effect doesn't re-fire when
  // the parent re-renders with a new function identity.
  const onScannedRef = useRef(onScanned);
  useEffect(() => {
    onScannedRef.current = onScanned;
  }, [onScanned]);

  useEffect(() => {
    if (!supported) {
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    // Captured at the point we attach the MediaStream so cleanup can
    // null `srcObject` on the same node we mutated, even if the ref
    // has been re-pointed by a later render.
    let attachedVideo: HTMLVideoElement | null = null;
    const detector = new window.BarcodeDetector!({ formats: ["qr_code"] });

    async function start(): Promise<void> {
      try {
        const requested = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          requested.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = requested;
        const video = videoRef.current;
        if (video === null) {
          requested.getTracks().forEach((track) => track.stop());
          return;
        }
        attachedVideo = video;
        video.srcObject = requested;
        // playsInline is set as an HTML attribute below; mobile
        // Safari needs it on the element to avoid full-screen
        // takeover when play() is called.
        await video.play().catch(() => {
          // play() rejects when the tab is backgrounded; the next
          // visibilitychange will retry implicitly because the user
          // will re-enter the unpaired flow.
        });
        intervalId = setInterval(() => {
          if (cancelled || video.readyState < 2) {
            return;
          }
          detector
            .detect(video)
            .then((results) => {
              if (cancelled || results.length === 0) {
                return;
              }
              for (const result of results) {
                const payload = tryParseQrText(result.rawValue);
                if (payload !== null) {
                  onScannedRef.current(payload);
                  return;
                }
              }
            })
            .catch(() => {
              // Per-frame detect() failures are usually transient
              // (e.g. a video frame the OS hasn't decoded yet). We
              // intentionally do not surface them; a persistent
              // failure manifests as "no QR detected", which the
              // user can resolve by re-pointing the camera or
              // falling back to paste.
            });
        }, SCAN_INTERVAL_MS);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof Error) {
          if (err.name === "NotAllowedError") {
            setCameraError(
              "Camera access denied. Grant permission and reload, or paste the QR JSON below."
            );
          } else if (err.name === "NotFoundError") {
            setCameraError(
              "No camera found on this device. Paste the QR JSON below."
            );
          } else {
            setCameraError(`Could not start camera: ${err.message}`);
          }
        } else {
          setCameraError("Could not start camera.");
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      if (stream !== null) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (attachedVideo !== null) {
        attachedVideo.srcObject = null;
      }
    };
  }, [supported]);

  const onPasteSubmit = useCallback(() => {
    const trimmed = pasted.trim();
    if (trimmed === "") {
      setPasteError("Paste the QR JSON first.");
      return;
    }
    const payload = tryParseQrText(trimmed);
    if (payload === null) {
      setPasteError(
        "That does not look like a QR payload. Expected JSON with relayUrl, pairingCode, desktopId, fingerprintHex."
      );
      return;
    }
    setPasteError("");
    onScannedRef.current(payload);
  }, [pasted]);

  return (
    <div>
      {supported ? (
        <div>
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: "100%", maxWidth: 360, background: "#000" }}
          />
          {cameraError !== "" && <p className="error">{cameraError}</p>}
          <p className="status">
            Point the camera at the QR shown on your desktop.
          </p>
        </div>
      ) : (
        <p className="status">
          Your browser cannot scan QR codes natively. Paste the QR JSON below
          instead.
        </p>
      )}

      {/* Paste fallback is always available so users can recover from
          camera failures without reloading. */}
      <details open={!supported || cameraError !== ""}>
        <summary>Paste QR JSON</summary>
        <textarea
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          rows={6}
          style={{ width: "100%" }}
          placeholder='{"relayUrl":"wss://...","pairingCode":"ABC123","desktopId":"desk-...","fingerprintHex":"..."}'
        />
        {pasteError !== "" && <p className="error">{pasteError}</p>}
        <button type="button" className="btn" onClick={onPasteSubmit}>
          Use pasted payload
        </button>
      </details>
    </div>
  );
}
