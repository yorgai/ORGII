// Barrel for the pairing module. Re-exports the public surface so
// App.tsx can import from "./pairing" rather than reaching into
// individual files.

export {
  PairingFlow,
  PAIRED_STORAGE_KEY,
  type PairedSession,
} from "./PairingFlow";
export { QrScanner, type QrPayload } from "./QrScanner";
