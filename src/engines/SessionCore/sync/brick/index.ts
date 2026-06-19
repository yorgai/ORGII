// Brick adapter: typed `brick history` client + Stage-1 shadow-read parity.
export {
  BrickHistoryClient,
  BrickContractError,
  BrickUnavailableError,
  MIN_SUPPORTED_HISTORY_CONTRACT_VERSION,
  parseSessionsPage,
  type BrickCommandResult,
  type BrickCommandRunner,
  type BrickHistorySession,
  type BrickHistorySessionsPage,
  type BrickVersionInfo,
} from "./brickHistoryClient";
export {
  compareSessionParity,
  runShadowReadParity,
  type OrgiiSessionRowForParity,
  type ParityMismatch,
  type ShadowReadParityReport,
} from "./brickShadowRead";
export { createTauriBrickRunner } from "./tauriBrickRunner";
