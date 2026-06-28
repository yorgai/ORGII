type ModeSwitchResultChoice = "switch" | "skip" | "defer";

export function resolveModeSwitchChoiceFromResultContent(
  resultContent: string
): ModeSwitchResultChoice | undefined {
  if (
    resultContent.startsWith("User accepted the mode switch") ||
    resultContent.startsWith("MODE_SWITCH_ACCEPTED")
  ) {
    return "switch";
  }
  if (resultContent.startsWith("User chose to stay in the current mode")) {
    return "skip";
  }
  if (
    resultContent.startsWith("User deferred the mode switch") ||
    resultContent.startsWith("MODE_SWITCH_DEFERRED")
  ) {
    return "defer";
  }
  return undefined;
}
