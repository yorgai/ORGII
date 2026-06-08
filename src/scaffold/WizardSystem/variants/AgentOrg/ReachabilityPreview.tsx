import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { OrgMember } from "@src/modules/MainApp/AgentOrgs/types";
import { truncate } from "@src/util/string/truncate";

import {
  type RoutingDecision,
  buildPreviewGraph,
  decideRouting,
  findIsolatedMemberIds,
} from "./routingPreview";

interface ReachabilityPreviewProps {
  /**
   * Coordinator-rooted org tree. Must already include the wizard's
   * current `hierarchyMode` on the root (or pass `hierarchyMode`
   * explicitly to override).
   */
  root: OrgMember;
  /**
   * Optional explicit override; if omitted, uses `root.hierarchyMode`.
   * The component is only meant to render under Strict — the parent
   * is responsible for hiding it otherwise.
   */
  hierarchyMode?: OrgMember["hierarchyMode"];
}

/**
 * Strict-mode reachability preview. Renders an N×N matrix of routing
 * decisions (✓ allowed, ✗ blocked) so the user can sanity-check
 * "which agent can directly contact which" before launching the org.
 *
 * Self routing (the diagonal) is shown as a muted dash — it isn't a
 * real Strict denial, just self-routing being filtered upstream by
 * `org_send_message`'s sender filter.
 *
 * Empty-state: an org with only the coordinator has nothing
 * meaningful to display, so the component renders a single hint
 * line instead of an empty matrix.
 */
export function ReachabilityPreview({
  root,
  hierarchyMode,
}: ReachabilityPreviewProps) {
  const { t } = useTranslation("integrations");

  const graph = useMemo(
    () => buildPreviewGraph(root, hierarchyMode),
    [root, hierarchyMode]
  );

  const isolatedIds = useMemo(() => findIsolatedMemberIds(graph), [graph]);

  if (graph.nodes.length <= 1) {
    return (
      <div className="text-fg-muted text-xs">
        {t("agentOrgs.orgWizard.reachability.empty")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isolatedIds.length > 0 ? (
        <div className="rounded-md border border-solid border-warning-3 bg-warning-1 px-3 py-2 text-xs text-warning-6">
          {t("agentOrgs.orgWizard.reachability.isolatedWarn", {
            names: isolatedIds
              .map(
                (id) => graph.nodes.find((node) => node.id === id)?.name ?? id
              )
              .join(", "),
          })}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="text-fg-muted px-2 py-1 text-left font-normal">
                {t("agentOrgs.orgWizard.reachability.fromHeader")}
              </th>
              {graph.nodes.map((node) => (
                <th
                  key={node.id}
                  className="text-fg-muted px-2 py-1 text-left font-normal"
                  title={node.name}
                >
                  {truncate(node.name, 14)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {graph.nodes.map((from) => (
              <tr key={from.id}>
                <th
                  className="text-fg-default px-2 py-1 text-left font-normal"
                  title={from.name}
                >
                  {truncate(from.name, 14)}
                </th>
                {graph.nodes.map((to) => {
                  const decision: RoutingDecision =
                    from.id === to.id
                      ? "blocked"
                      : decideRouting(graph, from.id, to.id);
                  const isSelf = from.id === to.id;
                  return (
                    <td
                      key={to.id}
                      className={cellClass(decision, isSelf)}
                      title={cellTitle(t, from.name, to.name, decision, isSelf)}
                    >
                      {cellGlyph(decision, isSelf)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function cellClass(decision: RoutingDecision, isSelf: boolean): string {
  if (isSelf) return "text-fg-muted px-2 py-1 text-center";
  return decision === "allowed"
    ? "text-success-6 px-2 py-1 text-center"
    : "text-warning-6 px-2 py-1 text-center";
}

function cellGlyph(decision: RoutingDecision, isSelf: boolean): string {
  if (isSelf) return "—";
  return decision === "allowed" ? "✓" : "✗";
}

function cellTitle(
  t: ReturnType<typeof useTranslation>["t"],
  fromName: string,
  toName: string,
  decision: RoutingDecision,
  isSelf: boolean
): string {
  if (isSelf) return fromName;
  return decision === "allowed"
    ? t("agentOrgs.orgWizard.reachability.allowedTitle", {
        from: fromName,
        to: toName,
      })
    : t("agentOrgs.orgWizard.reachability.blockedTitle", {
        from: fromName,
        to: toName,
      });
}
