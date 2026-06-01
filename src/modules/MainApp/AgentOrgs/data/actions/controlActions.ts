import type { ActionDefinition } from "../types";

export const controlActions: ActionDefinition[] = [
  {
    id: "wait",
    type: "wait",
    title: "Wait",
    titleKey: "agentOrgs.workflowActions.wait.title",
    description: "Pause execution for a specified time",
    descriptionKey: "agentOrgs.workflowActions.wait.description",
    icon: "Timer",
    color: "bg-orange-500",
    category: "Controls",
    categoryKey: "agentOrgs.workflowActions.categories.controls",
    inputs: [
      {
        type: "number",
        defaultValue: 30,
        unit: "second",
        unitKey: "agentOrgs.workflowActions.units.second",
      },
    ],
  },
  {
    id: "if",
    type: "if",
    title: "If",
    titleKey: "agentOrgs.workflowActions.if.title",
    description: "Conditional logic based on output",
    descriptionKey: "agentOrgs.workflowActions.if.description",
    icon: "Split",
    color: "bg-purple-500",
    category: "Controls",
    categoryKey: "agentOrgs.workflowActions.categories.controls",
    inputs: [
      {
        type: "select",
        label: "Condition",
        labelKey: "agentOrgs.workflowActions.if.condition",
        defaultValue: "equals",
        options: [
          {
            label: "Equals",
            labelKey: "agentOrgs.workflowActions.operators.equals",
            value: "equals",
          },
          {
            label: "Not Equals",
            labelKey: "agentOrgs.workflowActions.operators.notEquals",
            value: "not-equals",
          },
          {
            label: "Contains",
            labelKey: "agentOrgs.workflowActions.operators.contains",
            value: "contains",
          },
          {
            label: "Greater Than",
            labelKey: "agentOrgs.workflowActions.operators.greaterThan",
            value: "greater-than",
          },
          {
            label: "Less Than",
            labelKey: "agentOrgs.workflowActions.operators.lessThan",
            value: "less-than",
          },
          {
            label: "Is Empty",
            labelKey: "agentOrgs.workflowActions.operators.isEmpty",
            value: "is-empty",
          },
          {
            label: "Is Not Empty",
            labelKey: "agentOrgs.workflowActions.operators.isNotEmpty",
            value: "is-not-empty",
          },
        ],
      },
      {
        type: "text",
        placeholder: "Compare value",
        placeholderKey: "agentOrgs.workflowActions.placeholders.compareValue",
        defaultValue: "",
      },
    ],
  },
  {
    id: "loop",
    type: "loop",
    title: "Loop",
    titleKey: "agentOrgs.workflowActions.loop.title",
    description: "Repeat actions multiple times",
    descriptionKey: "agentOrgs.workflowActions.loop.description",
    icon: "Repeat",
    color: "bg-cyan-500",
    category: "Controls",
    categoryKey: "agentOrgs.workflowActions.categories.controls",
    inputs: [
      {
        type: "select",
        label: "Loop Type",
        labelKey: "agentOrgs.workflowActions.loop.loopType",
        defaultValue: "count",
        options: [
          {
            label: "Fixed Count",
            labelKey: "agentOrgs.workflowActions.loop.types.count",
            value: "count",
          },
          {
            label: "For Each Item",
            labelKey: "agentOrgs.workflowActions.loop.types.foreach",
            value: "foreach",
          },
          {
            label: "While Condition",
            labelKey: "agentOrgs.workflowActions.loop.types.while",
            value: "while",
          },
        ],
      },
      {
        type: "number",
        label: "Iterations",
        labelKey: "agentOrgs.workflowActions.loop.iterations",
        defaultValue: 3,
        placeholder: "Number of times to repeat",
        placeholderKey: "agentOrgs.workflowActions.placeholders.iterations",
      },
    ],
  },
];
