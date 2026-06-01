/**
 * Channel API helpers
 *
 * Delegates to the unified agent API for channel operations.
 */
import { probeChannel as probeChannelRaw } from "@src/api/tauri/agent";

import type { ChannelProbeResult } from "./types";

/**
 * Probe a channel's connectivity by testing credentials against the service API.
 *
 * @param channelType - Channel type (e.g. "telegram", "discord")
 * @param credentials - Flat object with channel-specific credential fields
 * @returns Probe result with ok/error/identity/elapsed_ms
 */
export async function probeChannel(
  channelType: string,
  credentials: Record<string, unknown>
): Promise<ChannelProbeResult> {
  return probeChannelRaw<ChannelProbeResult>(channelType, credentials);
}
