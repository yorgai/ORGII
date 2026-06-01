/**
 * useOutputChannels Hook
 *
 * Manages multiple output channels (like Tasks, Git, Build, etc.)
 * Similar to VS Code's Output panel.
 */
import { nanoid } from "nanoid";
import React, { useCallback, useState } from "react";

import type {
  OutputChannel,
  OutputChannelType,
} from "@src/types/workstation/output";

// ============================================
// Types
// ============================================

export interface UseOutputChannelsOptions {
  /** Default max characters per channel (default: 100000) */
  defaultMaxChars?: number;
  /** Auto-create channels on first append (default: true) */
  autoCreate?: boolean;
  /** Enable history persistence across re-renders (default: true) */
  persistHistory?: boolean;
}

export interface UseOutputChannelsReturn {
  /** All output channels */
  channels: OutputChannel[];
  /** Currently active channel ID */
  activeChannelId: string | null;
  /** Get channel by ID */
  getChannel: (channelId: string) => OutputChannel | undefined;
  /** Create a new channel */
  createChannel: (
    name: string,
    type: OutputChannelType,
    maxChars?: number
  ) => string;
  /** Delete a channel */
  deleteChannel: (channelId: string) => void;
  /** Append text to a channel */
  appendToChannel: (channelId: string, text: string) => void;
  /** Clear a channel */
  clearChannel: (channelId: string) => void;
  /** Clear all channels */
  clearAllChannels: () => void;
  /** Set active channel */
  setActiveChannel: (channelId: string) => void;
  /** Set channel active status */
  setChannelActive: (channelId: string, active: boolean) => void;
}

// ============================================
// Hook
// ============================================

// Persistent storage key for channel history
const HISTORY_STORAGE_KEY = "orgii_output_channels_history";

/**
 * Hook to manage multiple output channels
 */
export function useOutputChannels(
  options: UseOutputChannelsOptions = {}
): UseOutputChannelsReturn {
  const {
    defaultMaxChars = 100000,
    autoCreate = true,
    persistHistory = true,
  } = options;

  // Load initial state from history if enabled
  const getInitialChannelsMap = React.useCallback(() => {
    if (!persistHistory) return new Map<string, OutputChannel>();

    try {
      const stored = sessionStorage.getItem(HISTORY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return new Map(Object.entries(parsed) as [string, OutputChannel][]);
      }
    } catch (_error) {
      // Silently ignore history load failures
    }
    return new Map<string, OutputChannel>();
  }, [persistHistory]);

  // State: Map of channel ID -> channel
  const [channelsMap, setChannelsMap] = useState<Map<string, OutputChannel>>(
    getInitialChannelsMap
  );
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);

  // Persist channels to sessionStorage on changes
  React.useEffect(() => {
    if (!persistHistory || channelsMap.size === 0) return;

    try {
      const channelsObj = Object.fromEntries(channelsMap);
      sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(channelsObj));
    } catch (_error) {
      // Silently ignore history save failures
    }
  }, [channelsMap, persistHistory]);

  // Convert map to array for rendering
  const channels = Array.from(channelsMap.values());

  // Get channel by ID
  const getChannel = useCallback(
    (channelId: string): OutputChannel | undefined => {
      return channelsMap.get(channelId);
    },
    [channelsMap]
  );

  // Create a new channel
  const createChannel = useCallback(
    (name: string, type: OutputChannelType, maxChars?: number): string => {
      const channelId = nanoid();
      const newChannel: OutputChannel = {
        id: channelId,
        name,
        type,
        content: "",
        maxChars: maxChars ?? defaultMaxChars,
        active: false,
        processAnsi: true,
      };

      setChannelsMap((prev) => {
        const next = new Map(prev);
        next.set(channelId, newChannel);
        return next;
      });

      // Set as active if it's the first channel OR if it's the Git channel (priority)
      if (channelsMap.size === 0 || type === "git") {
        setActiveChannelId(channelId);
      }

      return channelId;
    },
    [defaultMaxChars, channelsMap.size]
  );

  // Delete a channel
  const deleteChannel = useCallback(
    (channelId: string) => {
      setChannelsMap((prev) => {
        const next = new Map(prev);
        next.delete(channelId);
        return next;
      });

      // If deleting active channel, switch to first available
      setActiveChannelId((prevActive) => {
        if (prevActive === channelId) {
          const remaining = Array.from(channelsMap.keys()).filter(
            (id) => id !== channelId
          );
          return remaining.length > 0 ? remaining[0] : null;
        }
        return prevActive;
      });
    },
    [channelsMap]
  );

  // Append text to a channel
  const appendToChannel = useCallback(
    (channelId: string, text: string) => {
      setChannelsMap((prev) => {
        const next = new Map(prev);
        let channel = next.get(channelId);

        // Auto-create channel if it doesn't exist
        if (!channel && autoCreate) {
          channel = {
            id: channelId,
            name: channelId,
            type: "custom",
            content: "",
            maxChars: defaultMaxChars,
            active: false,
            processAnsi: true,
          };
          next.set(channelId, channel);
        }

        if (!channel) return next;

        // Append text to content
        channel.content += text;

        // Trim to maxChars if needed
        const maxChars = channel.maxChars ?? defaultMaxChars;
        if (channel.content.length > maxChars) {
          // Keep the last maxChars characters
          channel.content = channel.content.slice(-maxChars);
        }

        return next;
      });
    },
    [autoCreate, defaultMaxChars]
  );

  // Clear a channel
  const clearChannel = useCallback((channelId: string) => {
    setChannelsMap((prev) => {
      const next = new Map(prev);
      const channel = next.get(channelId);
      if (channel) {
        channel.content = "";
      }
      return next;
    });
  }, []);

  // Clear all channels
  const clearAllChannels = useCallback(() => {
    setChannelsMap((prev) => {
      const next = new Map(prev);
      next.forEach((channel) => {
        channel.content = "";
      });
      return next;
    });
  }, []);

  // Set active channel
  const setActiveChannel = useCallback((channelId: string) => {
    setActiveChannelId(channelId);
  }, []);

  // Set channel active status
  const setChannelActive = useCallback((channelId: string, active: boolean) => {
    setChannelsMap((prev) => {
      const next = new Map(prev);
      const channel = next.get(channelId);
      if (channel) {
        channel.active = active;
      }
      return next;
    });
  }, []);

  return {
    channels,
    activeChannelId,
    getChannel,
    createChannel,
    deleteChannel,
    appendToChannel,
    clearChannel,
    clearAllChannels,
    setActiveChannel,
    setChannelActive,
  };
}
