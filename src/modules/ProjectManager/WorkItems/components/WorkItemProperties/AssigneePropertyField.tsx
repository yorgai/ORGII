import { AtSign, Network, User } from "lucide-react";

import Avatar from "@src/components/Avatar";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
} from "@src/components/Dropdown/tokens";
import { PropertyDropdownField } from "@src/components/PropertyField/PropertyDropdownField";
import {
  type FieldRowVariant,
  Option,
} from "@src/components/PropertyField/PropertyFieldEditable";
import type {
  AgentDefinition,
  OrgMember,
} from "@src/modules/MainApp/AgentOrgs/types";
import type { Person } from "@src/types/core/shared";
import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

interface AssigneePropertyFieldProps {
  workItem: WorkItemExtended;
  availableMembers: Person[];
  availableAgents?: AgentDefinition[];
  availableOrgs?: OrgMember[];
  allAgentList?: { id: string; name: string }[];
  onAssigneeChange: (person: Person | null, assigneeType?: string) => void;
  t: (key: string) => string;
  fieldVariant?: FieldRowVariant;
  placement?: "inline" | "portal";
  triggerVariant?: "row" | "pill" | "iconOnly";
  active?: boolean;
  onActiveChange?: (active: boolean) => void;
  readonly?: boolean;
  maxWidthClassName?: string;
  borderless?: boolean;
}

function renderAssigneeIcon(workItem: WorkItemExtended) {
  if (!workItem.assignee) return <User size={DROPDOWN_ITEM.iconSize} />;
  if (workItem.assigneeType === "agent") {
    return <AtSign size={DROPDOWN_ITEM.iconSize} className="text-primary-6" />;
  }
  if (workItem.assigneeType === "org") {
    return <Network size={DROPDOWN_ITEM.iconSize} className="text-primary-6" />;
  }
  return (
    <Avatar
      size={DROPDOWN_ITEM.iconSize}
      src={workItem.assignee.avatar}
      style={{
        backgroundColor: workItem.assignee.color || "var(--color-fill-3)",
        color: "var(--color-text-white)",
        fontSize: "11px",
      }}
    >
      {workItem.assignee.name.charAt(0).toUpperCase()}
    </Avatar>
  );
}

export function AssigneePropertyField({
  workItem,
  availableMembers,
  availableOrgs = [],
  allAgentList = [],
  onAssigneeChange,
  t,
  fieldVariant = "row",
  placement = "inline",
  triggerVariant,
  active,
  onActiveChange,
  readonly = false,
  maxWidthClassName,
  borderless = false,
}: AssigneePropertyFieldProps) {
  const label = workItem.assignee?.name || t("workItems.properties.noAssignee");
  return (
    <PropertyDropdownField
      value={workItem.assignee?.id ?? "__none__"}
      label={label}
      icon={renderAssigneeIcon(workItem)}
      options={[]}
      placement={placement}
      fieldVariant={fieldVariant}
      triggerVariant={triggerVariant ?? fieldVariant}
      selected={!!workItem.assignee}
      searchable
      searchPlaceholder={t("properties.searchAssignee")}
      active={active}
      onActiveChange={onActiveChange}
      onClear={() => onAssigneeChange(null)}
      readonly={readonly}
      maxWidthClassName={maxWidthClassName}
      borderless={borderless}
      renderOptions={(searchQuery, close) => {
        const query = searchQuery?.toLowerCase() ?? "";
        const filteredMembers = query
          ? availableMembers.filter((person) =>
              person.name.toLowerCase().includes(query)
            )
          : availableMembers;
        const filteredAgents = query
          ? allAgentList.filter((agent) =>
              agent.name.toLowerCase().includes(query)
            )
          : allAgentList;
        const filteredOrgs = query
          ? availableOrgs.filter((org) =>
              org.name.toLowerCase().includes(query)
            )
          : availableOrgs;

        const select = (person: Person | null, assigneeType?: string) => {
          onAssigneeChange(person, assigneeType);
          close();
        };

        return (
          <>
            <Option
              icon={<User size={DROPDOWN_ITEM.iconSize} />}
              label={t("workItems.properties.noAssignee")}
              isSelected={!workItem.assignee}
              onClick={() => select(null)}
            />
            {filteredMembers.length > 0 && (
              <div className={DROPDOWN_CLASSES.sectionLabel}>
                {t("workItems.properties.membersGroup")}
              </div>
            )}
            {filteredMembers.map((person) => (
              <Option
                key={person.id}
                isSelected={workItem.assignee?.id === person.id}
                label={person.name}
                onClick={() => select(person)}
              >
                <Avatar
                  size={DROPDOWN_ITEM.iconSize}
                  src={person.avatar}
                  style={{
                    backgroundColor: person.color || "var(--color-fill-3)",
                    color: "var(--color-text-white)",
                    fontSize: "11px",
                  }}
                >
                  {person.name.charAt(0).toUpperCase()}
                </Avatar>
                <span className="flex-1 truncate">{person.name}</span>
              </Option>
            ))}
            {filteredAgents.length > 0 && (
              <div className={DROPDOWN_CLASSES.sectionLabel}>
                {t("workItems.properties.agentsGroup")}
              </div>
            )}
            {filteredAgents.map((agent) => (
              <Option
                key={`agent-${agent.id}`}
                isSelected={
                  workItem.assignee?.id === agent.id &&
                  workItem.assigneeType === "agent"
                }
                label={agent.name}
                onClick={() =>
                  select({ id: agent.id, name: agent.name }, "agent")
                }
              >
                <AtSign
                  size={DROPDOWN_ITEM.iconSize}
                  className="text-primary-6"
                />
                <span className="flex-1 truncate">{agent.name}</span>
              </Option>
            ))}
            {filteredOrgs.length > 0 && (
              <div className={DROPDOWN_CLASSES.sectionLabel}>
                {t("workItems.properties.orgsGroup")}
              </div>
            )}
            {filteredOrgs.map((org) => (
              <Option
                key={`org-${org.id}`}
                isSelected={
                  workItem.assignee?.id === org.id &&
                  workItem.assigneeType === "org"
                }
                label={org.name}
                onClick={() => select({ id: org.id, name: org.name }, "org")}
              >
                <Network
                  size={DROPDOWN_ITEM.iconSize}
                  className="text-primary-6"
                />
                <span className="flex-1 truncate">{org.name}</span>
              </Option>
            ))}
          </>
        );
      }}
    />
  );
}
