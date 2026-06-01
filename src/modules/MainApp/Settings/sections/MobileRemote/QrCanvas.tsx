/**
 * QrCanvas
 *
 * Renders a QR code from an arbitrary string payload. The pairing
 * payload is the JSON string returned by `mobile_remote_pair_init`'s
 * `qrPayload` field; we render it verbatim — the mobile PWA decodes
 * and validates it.
 *
 * Dependency: `qrcode.react` (npm). Picked because it ships first-party
 * TypeScript types and is the most-used React QR library. The parent
 * agent runs `npm install qrcode.react` after merging this batch — do
 * NOT add it to package.json from this subagent.
 */
import { QRCodeCanvas } from "qrcode.react";
import React from "react";

interface QrCanvasProps {
  payload: string;
  /** Edge length in pixels. Defaults to 224 (matches the dialog body). */
  size?: number;
}

const DEFAULT_SIZE = 224;

const QrCanvas: React.FC<QrCanvasProps> = ({
  payload,
  size = DEFAULT_SIZE,
}) => {
  return (
    <div
      className="inline-flex items-center justify-center rounded-lg bg-white p-3"
      style={{ width: size + 24, height: size + 24 }}
    >
      <QRCodeCanvas
        value={payload}
        size={size}
        level="M"
        includeMargin={false}
        bgColor="#ffffff"
        fgColor="#000000"
      />
    </div>
  );
};

export default QrCanvas;
