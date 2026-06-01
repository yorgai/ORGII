import Message from "@src/components/Message";

// Helper to calculate approximate font size based on scale
export const getApproxFontSize = (scale: number): string => {
  const baseFontSize = 14; // Base font size in px
  const scaledSize = Math.round((baseFontSize * scale) / 100);
  return `${scaledSize}px`;
};

// Helper to show scale change message
export const showScaleMessage = (scale: number) => {
  const fontSize = getApproxFontSize(scale);
  Message.info({
    id: "ui-scale-message",
    content: `UI scale: ${scale}% · Font: ${fontSize}`,
    duration: 1500,
  });
};

// Helper to check if target is an editable element
export const isEditableElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable ||
    target.getAttribute("contenteditable") === "true" ||
    target.closest(".cm-editor") !== null ||
    target.closest(".xterm") !== null
  );
};

// Extended editable check (includes more selectors for backspace handling)
export const isEditableElementExtended = (
  target: EventTarget | null
): boolean => {
  if (!(target instanceof HTMLElement)) return false;

  return (
    isEditableElement(target) ||
    target.closest(".cm-content") !== null ||
    target.closest('[contenteditable="true"]') !== null ||
    target.closest(".xterm-terminal-container") !== null
  );
};
