import { useAtom, useAtomValue } from "jotai";
import { Check, Code2, Cpu, Grip, Omega } from "lucide-react";
import React, { memo, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { DISPATCH_CATEGORY } from "@src/api/tauri/session";
import { CLI_AGENT, type CliAgentType } from "@src/api/types/keys";
import { formatAgentType } from "@src/assets/providers";
import ModelIcon from "@src/components/ModelIcon";
import type { IconProvider } from "@src/components/ModelIcon";
import { TreeRowBase, type TreeRowNode } from "@src/components/TreeRow";
import {
  KANBAN_AGENT_TYPE_FILTER,
  KANBAN_COLUMNS,
  KANBAN_SIDEBAR_FILTER,
  type KanbanAgentTypeFilter,
  type KanbanSidebarFilter,
} from "@src/features/TaskKanban/config";
import {
  PrimarySidebarLayout,
  type PrimarySidebarTab,
} from "@src/modules/WorkStation/shared";
import { sessionsAtom } from "@src/store/session";
import {
  kanbanAgentTypeFilterAtom,
  kanbanSidebarFilterAtom,
} from "@src/store/ui/kanbanViewStateAtom";
import { getDispatchCategory } from "@src/util/session/sessionDispatch";
import { isPrimarySessionListSession } from "@src/util/session/sessionVisibility";

const OPS_CONTROL_SIDEBAR_TAB = "kanban";
const KANBAN_FILTER_ICON_SIZE = 14;

const CLI_AGENT_FILTERS: readonly CliAgentType[] = [
  CLI_AGENT.CURSOR,
  CLI_AGENT.CLAUDE_CODE,
  CLI_AGENT.CODEX,
  CLI_AGENT.GEMINI,
  CLI_AGENT.COPILOT,
  CLI_AGENT.KIRO,
  CLI_AGENT.KIMI,
  CLI_AGENT.OPENCODE,
];

const CLI_AGENT_ICON_PROVIDER: Record<CliAgentType, IconProvider> = {
  [CLI_AGENT.CURSOR]: "cursor",
  [CLI_AGENT.CLAUDE_CODE]: "claude_code",
  [CLI_AGENT.CODEX]: "openai",
  [CLI_AGENT.GEMINI]: "gemini",
  [CLI_AGENT.COPILOT]: "copilot",
  [CLI_AGENT.KIRO]: "kiro",
  [CLI_AGENT.KIMI]: "kimi",
  [CLI_AGENT.OPENCODE]: "opencode",
};

const handleSidebarTabChange = () => {};

interface KanbanFilterItem<TFilter extends string> {
  key: TFilter;
  label?: string;
  labelKey?: string;
  icon: React.ReactNode;
}

const KANBAN_STATUS_FILTER_ITEMS: KanbanFilterItem<KanbanSidebarFilter>[] = [
  {
    key: KANBAN_SIDEBAR_FILTER.ALL,
    labelKey: "common:actions.all",
    icon: <Grip size={KANBAN_FILTER_ICON_SIZE} strokeWidth={1.75} />,
  },
  ...KANBAN_COLUMNS.map((column) => {
    const Icon = column.icon;
    return {
      key: column.id as KanbanSidebarFilter,
      labelKey: column.title,
      icon: <Icon size={KANBAN_FILTER_ICON_SIZE} strokeWidth={1.75} />,
    };
  }),
];

const ALL_AGENT_TYPE_FILTER_ITEM: KanbanFilterItem<KanbanAgentTypeFilter> = {
  key: KANBAN_AGENT_TYPE_FILTER.ALL,
  labelKey: "common:actions.all",
  icon: <Grip size={KANBAN_FILTER_ICON_SIZE} strokeWidth={1.75} />,
};

const RUST_AGENT_FILTER_ITEMS: Record<
  | typeof KANBAN_AGENT_TYPE_FILTER.OS_AGENT
  | typeof KANBAN_AGENT_TYPE_FILTER.SDE_AGENT,
  KanbanFilterItem<KanbanAgentTypeFilter>
> = {
  [KANBAN_AGENT_TYPE_FILTER.OS_AGENT]: {
    key: KANBAN_AGENT_TYPE_FILTER.OS_AGENT,
    labelKey: "creator.osAgent",
    icon: <Omega size={KANBAN_FILTER_ICON_SIZE} strokeWidth={1.75} />,
  },
  [KANBAN_AGENT_TYPE_FILTER.SDE_AGENT]: {
    key: KANBAN_AGENT_TYPE_FILTER.SDE_AGENT,
    labelKey: "creator.agent",
    icon: <Code2 size={KANBAN_FILTER_ICON_SIZE} strokeWidth={1.75} />,
  },
};

const CURSOR_IDE_FILTER_ITEM: KanbanFilterItem<KanbanAgentTypeFilter> = {
  key: KANBAN_AGENT_TYPE_FILTER.CURSOR_IDE,
  labelKey: "creator.cursorIde.label",
  icon: <ModelIcon provider="cursor" size={KANBAN_FILTER_ICON_SIZE} />,
};

const CLI_AGENT_FILTER_ITEMS = new Map<
  CliAgentType,
  KanbanFilterItem<KanbanAgentTypeFilter>
>(
  CLI_AGENT_FILTERS.map((cliAgentType) => [
    cliAgentType,
    {
      key: cliAgentType as KanbanAgentTypeFilter,
      label: formatAgentType(cliAgentType),
      icon: (
        <ModelIcon
          provider={CLI_AGENT_ICON_PROVIDER[cliAgentType]}
          size={KANBAN_FILTER_ICON_SIZE}
        />
      ),
    },
  ])
);

function getAgentTypeFilterForSession(
  sessionId: string,
  cliAgentType: CliAgentType | undefined,
  agentDefinitionId: string | undefined
): KanbanAgentTypeFilter | null {
  const category = getDispatchCategory(sessionId);
  if (category === DISPATCH_CATEGORY.CURSOR_IDE) {
    return KANBAN_AGENT_TYPE_FILTER.CURSOR_IDE;
  }
  if (category === DISPATCH_CATEGORY.CLI_AGENT) {
    return cliAgentType ? (cliAgentType as KanbanAgentTypeFilter) : null;
  }
  if (category === DISPATCH_CATEGORY.RUST_AGENT) {
    return agentDefinitionId ?? null;
  }
  return null;
}

interface KanbanFilterRowsProps<TFilter extends string> {
  activeFilter: TFilter;
  items: KanbanFilterItem<TFilter>[];
  onSelectFilter: (filter: TFilter) => void;
}

function KanbanFilterRows<TFilter extends string>({
  activeFilter,
  items,
  onSelectFilter,
}: KanbanFilterRowsProps<TFilter>) {
  const { t } = useTranslation(["sessions", "common"]);

  return (
    <div className="min-h-0 flex-1">
      {items.map((item) => {
        const isActive = activeFilter === item.key;
        const label =
          item.label ?? (item.labelKey ? t(item.labelKey) : item.key);
        const node: TreeRowNode = {
          id: item.key,
          name: label,
          path: item.key,
          type: "file",
          icon: item.icon,
        };

        return (
          <TreeRowBase
            key={item.key}
            node={node}
            depth={0}
            isSelected={isActive}
            onClick={() => onSelectFilter(item.key)}
            showIndentGuides={false}
          >
            {isActive && (
              <Check
                size={13}
                strokeWidth={2}
                className="ml-auto flex-shrink-0 text-primary-6"
              />
            )}
          </TreeRowBase>
        );
      })}
    </div>
  );
}

export const OpsControlPrimarySidebar: React.FC = memo(() => {
  const { t } = useTranslation("sessions");
  const [activeStatusFilter, setActiveStatusFilter] = useAtom(
    kanbanSidebarFilterAtom
  );
  const [activeAgentTypeFilter, setActiveAgentTypeFilter] = useAtom(
    kanbanAgentTypeFilterAtom
  );
  const sessions = useAtomValue(sessionsAtom);
  const kanbanLabel = t("kanban.view.kanban");

  const agentTypeFilterItems = useMemo(() => {
    const presentFilters = new Set<KanbanAgentTypeFilter>();
    const rustAgentLabels = new Map<string, string>();
    for (const session of sessions) {
      if (!isPrimarySessionListSession(session)) continue;

      const filter = getAgentTypeFilterForSession(
        session.session_id,
        session.cliAgentType,
        session.agentDefinitionId
      );
      if (!filter) continue;
      presentFilters.add(filter);
      if (
        getDispatchCategory(session.session_id) === DISPATCH_CATEGORY.RUST_AGENT
      ) {
        rustAgentLabels.set(filter, session.agentDisplayName ?? filter);
      }
    }

    const items: KanbanFilterItem<KanbanAgentTypeFilter>[] = [
      ALL_AGENT_TYPE_FILTER_ITEM,
    ];
    for (const filter of [
      KANBAN_AGENT_TYPE_FILTER.OS_AGENT,
      KANBAN_AGENT_TYPE_FILTER.SDE_AGENT,
    ] as const) {
      if (presentFilters.has(filter)) {
        items.push(RUST_AGENT_FILTER_ITEMS[filter]);
      }
    }
    const customRustFilters = Array.from(rustAgentLabels.entries())
      .filter(
        ([filter]) =>
          filter !== KANBAN_AGENT_TYPE_FILTER.OS_AGENT &&
          filter !== KANBAN_AGENT_TYPE_FILTER.SDE_AGENT
      )
      .sort(([, labelA], [, labelB]) => labelA.localeCompare(labelB));
    for (const [filter, label] of customRustFilters) {
      items.push({
        key: filter,
        label,
        icon: <Cpu size={KANBAN_FILTER_ICON_SIZE} strokeWidth={1.75} />,
      });
    }
    if (presentFilters.has(KANBAN_AGENT_TYPE_FILTER.CURSOR_IDE)) {
      items.push(CURSOR_IDE_FILTER_ITEM);
    }
    for (const cliAgentType of CLI_AGENT_FILTERS) {
      if (presentFilters.has(cliAgentType as KanbanAgentTypeFilter)) {
        const item = CLI_AGENT_FILTER_ITEMS.get(cliAgentType);
        if (item) items.push(item);
      }
    }
    return items;
  }, [sessions]);

  useEffect(() => {
    if (activeAgentTypeFilter === KANBAN_AGENT_TYPE_FILTER.ALL) return;
    const selectedFilterExists = agentTypeFilterItems.some(
      (item) => item.key === activeAgentTypeFilter
    );
    if (!selectedFilterExists) {
      setActiveAgentTypeFilter(KANBAN_AGENT_TYPE_FILTER.ALL);
    }
  }, [activeAgentTypeFilter, agentTypeFilterItems, setActiveAgentTypeFilter]);

  const tabs: PrimarySidebarTab[] = useMemo(
    () => [
      {
        key: OPS_CONTROL_SIDEBAR_TAB,
        label: kanbanLabel,
        sections: [
          {
            key: "status",
            title: t("common:labels.status"),
            content: (
              <KanbanFilterRows
                activeFilter={activeStatusFilter}
                items={KANBAN_STATUS_FILTER_ITEMS}
                onSelectFilter={setActiveStatusFilter}
              />
            ),
            defaultFlexGrow: 1,
            resizable: false,
          },
          {
            key: "agent-types",
            title: t("kanban.sidebar.agentTypes"),
            content: (
              <KanbanFilterRows
                activeFilter={activeAgentTypeFilter}
                items={agentTypeFilterItems}
                onSelectFilter={setActiveAgentTypeFilter}
              />
            ),
            defaultFlexGrow: 1,
            resizable: false,
          },
        ],
      },
    ],
    [
      activeAgentTypeFilter,
      activeStatusFilter,
      agentTypeFilterItems,
      kanbanLabel,
      setActiveAgentTypeFilter,
      setActiveStatusFilter,
      t,
    ]
  );

  return (
    <PrimarySidebarLayout
      tabs={tabs}
      activeTab={OPS_CONTROL_SIDEBAR_TAB}
      onTabChange={handleSidebarTabChange}
      hideTabs
    />
  );
});

OpsControlPrimarySidebar.displayName = "OpsControlPrimarySidebar";

export default OpsControlPrimarySidebar;
