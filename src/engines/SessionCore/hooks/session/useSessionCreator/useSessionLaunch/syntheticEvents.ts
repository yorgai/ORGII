import { createSyntheticUserEvent } from "./launchHelpers";

export interface InjectSyntheticUserEventOptions {
  dispatchLoadSession: (update: {
    sessionId: string;
    events: Array<ReturnType<typeof createSyntheticUserEvent>>;
  }) => void;
  hasImages: boolean;
  imageDataUrls: string[] | undefined;
  isBackgroundLaunch: boolean;
  isContentEmpty: boolean;
  sessionId: string;
  setLastUserMessage: (message: {
    sessionId: string;
    displayContent: string;
    imageDataUrls: string[] | undefined;
  }) => void;
  setPendingSyntheticEvent: (
    event: ReturnType<typeof createSyntheticUserEvent>
  ) => void;
  userInput: string;
}

export function injectSyntheticUserEventIfNeeded(
  options: InjectSyntheticUserEventOptions
): void {
  const {
    dispatchLoadSession,
    hasImages,
    imageDataUrls,
    isBackgroundLaunch,
    isContentEmpty,
    sessionId,
    setLastUserMessage,
    setPendingSyntheticEvent,
    userInput,
  } = options;

  if (!userInput || isContentEmpty || isBackgroundLaunch) {
    return;
  }

  const syntheticEvent = createSyntheticUserEvent(sessionId, userInput);
  setPendingSyntheticEvent(syntheticEvent);
  dispatchLoadSession({ sessionId, events: [syntheticEvent] });
  setLastUserMessage({
    sessionId,
    displayContent: userInput,
    imageDataUrls: hasImages ? imageDataUrls : undefined,
  });
}
