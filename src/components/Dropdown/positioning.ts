import { getViewportSize } from "@src/util/ui/window/viewport";

import { DROPDOWN_PANEL } from "./tokens";
import type { DropdownPosition } from "./types";

export interface DropdownCoordinates {
  top: number;
  left: number;
  transform?: string;
}

interface CalculateDropdownPositionParams {
  position: DropdownPosition;
  triggerElement: HTMLElement;
  containerElement: HTMLElement;
  dropdownElement: HTMLElement | null;
  avoidViewportOverflow: boolean;
}

export function getPortalTransform(
  position: DropdownPosition
): string | undefined {
  switch (position) {
    case "top":
      return "translate(-50%, -100%)";
    case "top-start":
    case "tr":
      return "translateY(-100%)";
    case "top-end":
    case "tl":
      return "translate(-100%, -100%)";
    case "bottom":
      return "translateX(-50%)";
    case "bottom-end":
    case "bl":
      return "translateX(-100%)";
    case "left":
    case "right":
      return "translateY(-50%)";
    case "left-end":
    case "right-end":
      return "translateY(-100%)";
    default:
      return undefined;
  }
}

export function getPositionClasses(position: DropdownPosition): string {
  const positionMap: Record<DropdownPosition, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    "top-start": "bottom-full left-0 mb-2",
    "top-end": "bottom-full right-0 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    "bottom-start": "top-full left-0 mt-2",
    "bottom-end": "top-full right-0 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    "left-start": "right-full top-0 mr-2",
    "left-end": "right-full bottom-0 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
    "right-start": "left-full top-0 ml-2",
    "right-end": "left-full bottom-0 ml-2",
    tl: "bottom-full right-0 mb-2",
    tr: "bottom-full left-0 mb-2",
    bl: "top-full right-0 mt-2",
    br: "top-full left-0 mt-2",
  };
  return positionMap[position] || positionMap.bottom;
}

export function calculateDropdownPosition({
  position,
  triggerElement,
  containerElement,
  dropdownElement,
  avoidViewportOverflow,
}: CalculateDropdownPositionParams): DropdownCoordinates {
  const triggerRect = triggerElement.getBoundingClientRect();
  const containerRect = containerElement.getBoundingClientRect();
  const gap = DROPDOWN_PANEL.triggerGapTight;

  let top = 0;
  let left = 0;

  switch (position) {
    case "top":
      top = triggerRect.top - containerRect.top - gap;
      left = triggerRect.left - containerRect.left + triggerRect.width / 2;
      break;
    case "top-start":
      top = triggerRect.top - containerRect.top - gap;
      left = triggerRect.left - containerRect.left;
      break;
    case "top-end":
      top = triggerRect.top - containerRect.top - gap;
      left = triggerRect.right - containerRect.left;
      break;
    case "bottom":
      top = triggerRect.bottom - containerRect.top + gap;
      left = triggerRect.left - containerRect.left + triggerRect.width / 2;
      break;
    case "bottom-start":
      top = triggerRect.bottom - containerRect.top + gap;
      left = triggerRect.left - containerRect.left;
      break;
    case "bottom-end":
      top = triggerRect.bottom - containerRect.top + gap;
      left = triggerRect.right - containerRect.left;
      break;
    case "left":
      top = triggerRect.top - containerRect.top + triggerRect.height / 2;
      left = triggerRect.left - containerRect.left - gap;
      break;
    case "left-start":
      top = triggerRect.top - containerRect.top;
      left = triggerRect.left - containerRect.left - gap;
      break;
    case "left-end":
      top = triggerRect.bottom - containerRect.top;
      left = triggerRect.left - containerRect.left - gap;
      break;
    case "right":
      top = triggerRect.top - containerRect.top + triggerRect.height / 2;
      left = triggerRect.right - containerRect.left + gap;
      break;
    case "right-start":
      top = triggerRect.top - containerRect.top;
      left = triggerRect.right - containerRect.left + gap;
      break;
    case "right-end":
      top = triggerRect.bottom - containerRect.top;
      left = triggerRect.right - containerRect.left + gap;
      break;
    case "tl":
      top = triggerRect.top - containerRect.top - gap;
      left = triggerRect.right - containerRect.left;
      break;
    case "tr":
      top = triggerRect.top - containerRect.top - gap;
      left = triggerRect.left - containerRect.left;
      break;
    case "bl":
      top = triggerRect.bottom - containerRect.top + gap;
      left = triggerRect.right - containerRect.left;
      break;
    case "br":
      top = triggerRect.bottom - containerRect.top + gap;
      left = triggerRect.left - containerRect.left;
      break;
    default:
      top = triggerRect.bottom - containerRect.top + gap;
      left = triggerRect.left - containerRect.left + triggerRect.width / 2;
  }

  let transform = getPortalTransform(position);

  if (avoidViewportOverflow && dropdownElement) {
    const dropdownRect = dropdownElement.getBoundingClientRect();
    const viewportPadding = 8;

    const { width: vw } = getViewportSize();
    if (
      position.startsWith("bottom") &&
      dropdownRect.width > 0 &&
      triggerRect.left + dropdownRect.width > vw - viewportPadding
    ) {
      left = triggerRect.right - containerRect.left;
      transform = "translateX(-100%)";
    } else if (
      position.startsWith("right") &&
      dropdownRect.width > 0 &&
      triggerRect.right + gap + dropdownRect.width > vw - viewportPadding
    ) {
      left = triggerRect.left - containerRect.left - gap;
      transform = position.endsWith("end")
        ? "translate(-100%, -100%)"
        : "translateX(-100%)";
    }

    if (dropdownRect.width > 0) {
      const transformedLeft = transform?.includes("-100%")
        ? left - dropdownRect.width
        : transform?.includes("-50%")
          ? left - dropdownRect.width / 2
          : left;
      const minLeft = viewportPadding - containerRect.left;
      const maxLeft = vw - viewportPadding - containerRect.left;

      if (transformedLeft < minLeft) {
        left += minLeft - transformedLeft;
      } else if (transformedLeft + dropdownRect.width > maxLeft) {
        left -= transformedLeft + dropdownRect.width - maxLeft;
      }
    }
  }

  return { top, left, transform };
}
