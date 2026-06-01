import { AssigneePropertyField } from "../WorkItemProperties/AssigneePropertyField";
import type { AssigneeCellProps } from "./types";

export function AssigneeCell({
  workItem,
  availableMembers,
  onAssigneeSelect,
  readonly = false,
  t,
}: AssigneeCellProps) {
  return (
    <AssigneePropertyField
      workItem={workItem}
      availableMembers={availableMembers}
      onAssigneeChange={(person) => onAssigneeSelect?.(person)}
      t={t}
      fieldVariant="pill"
      placement="portal"
      triggerVariant={workItem.assignee ? "pill" : "iconOnly"}
      readonly={readonly || !onAssigneeSelect}
      maxWidthClassName={workItem.assignee ? "max-w-[180px]" : "w-7 max-w-7"}
      borderless
    />
  );
}
