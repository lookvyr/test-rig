import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import type { AgentPanelWorkflowGroup } from "../agentPanelModel";
import { ThreadHoverCardPopup } from "../ThreadHoverCard";
import { CollapsibleSectionHeader, SectionHeaderStatus } from "../ui/collapsible-section-header";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import { AgentElapsed } from "./AgentElapsed";
import { SubagentTooltipContent } from "./SubagentTooltipContent";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadRelationshipIcon } from "./ThreadRelationshipIcon";
import {
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";

type WorkflowPhase = AgentPanelWorkflowGroup["phases"][number];

function phaseElapsed(phase: WorkflowPhase) {
  const instants = (key: "startedAt" | "completedAt") =>
    phase.members
      .map((member) => member[key])
      .filter((value) => value !== null)
      .sort();
  const running = phase.state === "running";
  const startedAt = instants("startedAt")[0] ?? null;
  const completedAt = running ? null : (instants("completedAt").at(-1) ?? null);
  return {
    status: running ? ("running" as const) : ("completed" as const),
    startedAt: running || completedAt !== null ? startedAt : null,
    completedAt,
  };
}

function phaseStatusLabel(phase: WorkflowPhase) {
  if (phase.state === "running") return "running";
  if (phase.members.some((member) => member.status === "failed")) return "failed";
  if (
    phase.members.some((member) => member.status === "cancelled" || member.status === "interrupted")
  ) {
    return "stopped";
  }
  return phase.state === "done" ? "done" : "not started";
}

type WorkflowProviderProps = {
  readonly providerInstanceId: ProviderInstanceId;
  readonly provider: ServerProvider | undefined;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly driver: ProviderDriverKind | undefined;
};

/** One workflow agent: its name and time, with model, status and result on hover. */
function WorkflowMemberRow({
  member,
  providerInstanceId,
  provider,
  providers,
  driver,
}: { readonly member: RuntimeSubagent } & WorkflowProviderProps) {
  return (
    <li data-workflow-member={member.agentIndex ?? undefined}>
      <Tooltip>
        <TooltipTrigger
          delay={200}
          render={<div className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-sm" />}
        >
          <ThreadRelationshipIcon driver={driver} provider={provider} status={member.status} />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground/80">
            {member.title}
          </span>
          <span className="sr-only">{member.status}</span>
          {member.startedAt ? (
            <span className="shrink-0 text-2xs font-normal tabular-nums text-muted-foreground">
              <AgentElapsed agent={member} />
            </span>
          ) : null}
        </TooltipTrigger>
        <ThreadHoverCardPopup side="left">
          <SubagentTooltipContent
            title={member.title}
            model={member.model}
            providerInstanceId={providerInstanceId}
            origin="provider_native"
            provider={provider}
            providers={providers}
            driver={driver}
            elapsed={<AgentElapsed agent={member} />}
            status={member.status}
            result={member.result ?? member.error}
            progress={member.progress}
          />
        </ThreadHoverCardPopup>
      </Tooltip>
    </li>
  );
}

function WorkflowScript({
  environmentId,
  threadId,
  scriptPath,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly scriptPath: string;
}) {
  const { data, error } = useEnvironmentQuery(
    orchestrationEnvironment.workflowScript({ environmentId, input: { threadId, scriptPath } }),
  );
  if (error !== null && error !== undefined) {
    return <p className="px-2.5 py-1.5 text-2xs text-muted-foreground">Script unavailable.</p>;
  }
  if (data === undefined || data === null) {
    return <p className="px-2.5 py-1.5 text-2xs text-muted-foreground">Loading script…</p>;
  }
  return (
    <pre className="mx-2.5 my-1 max-h-48 overflow-auto rounded-md border border-border/60 bg-muted/40 p-2 font-mono text-2xs leading-4 text-foreground/80">
      {data.contents}
      {data.truncated ? "\n…" : ""}
    </pre>
  );
}

/**
 * A provider-native workflow run (Claude's Workflow tool) in the Lineage
 * panel: its coordinator row, and when expanded, its phases and agents and
 * the script it ran. Finished phases start collapsed so a settled workflow
 * reads as one line per phase.
 */
export function ThreadLineageWorkflowRow({
  environmentId,
  threadId,
  group,
  header,
  ...providerProps
}: {
  readonly environmentId: EnvironmentId;
  /** The thread that launched the workflow. */
  readonly threadId: ThreadId;
  readonly group: AgentPanelWorkflowGroup;
  readonly header: ReactNode;
} & WorkflowProviderProps) {
  const [expanded, setExpanded] = useState(false);
  const [phaseOpen, setPhaseOpen] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  const [scriptOpen, setScriptOpen] = useState(false);
  const label = group.workflow.workflowName ?? group.workflow.title;
  const phases = group.phases.filter((phase) => phase.members.length > 0);
  const scriptPath = group.workflow.runHandles?.scriptPath;
  const memberCount =
    group.phases.reduce((count, phase) => count + phase.members.length, 0) +
    group.unphasedMembers.length;
  return (
    <li className="group" data-workflow-expanded={expanded ? "" : undefined}>
      <div className={cn("relative", THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS)}>
        {header}
        <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
        <ThreadDetailsControl
          size="sm"
          variant="ghost"
          part="secondary"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} workflow ${label}, ${memberCount} ${memberCount === 1 ? "agent" : "agents"}`}
          data-workflow-toggle="true"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </ThreadDetailsControl>
      </div>
      {expanded ? (
        <ul className="m-0 list-none p-0 ps-6.5">
          {phases.map((phase) => {
            const open = phaseOpen.get(phase.index) ?? phase.state === "running";
            const status = phaseStatusLabel(phase);
            return (
              <li key={phase.index}>
                <CollapsibleSectionHeader
                  tone={phase.state === "running" ? "emphasized" : "muted"}
                  expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} ${phase.title} phase, ${status}`}
                  onClick={() =>
                    setPhaseOpen((current) => new Map(current).set(phase.index, !open))
                  }
                  accessory={
                    <>
                      {status === "failed" ? (
                        <SectionHeaderStatus>Failed</SectionHeaderStatus>
                      ) : null}
                      <span className="shrink-0 text-2xs font-normal tabular-nums">
                        {phase.settledCount}/{phase.members.length}{" "}
                        {phase.members.length === 1 ? "agent" : "agents"}
                      </span>
                      <span className="shrink-0 text-2xs font-normal tabular-nums empty:hidden">
                        <AgentElapsed agent={phaseElapsed(phase)} />
                      </span>
                    </>
                  }
                >
                  {phase.title}
                </CollapsibleSectionHeader>
                {open ? (
                  <ul className="m-0 list-none p-0">
                    {phase.members.map((member) => (
                      <WorkflowMemberRow key={member.id} member={member} {...providerProps} />
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
          {group.unphasedMembers.map((member) => (
            <WorkflowMemberRow key={member.id} member={member} {...providerProps} />
          ))}
          {phases.length === 0 && group.unphasedMembers.length === 0 ? (
            <li className="px-2.5 py-1.5 text-2xs text-muted-foreground/70">No agents yet</li>
          ) : null}
          {scriptPath === undefined ? null : (
            <li>
              <CollapsibleSectionHeader
                tone="muted"
                expanded={scriptOpen}
                aria-label={`${scriptOpen ? "Hide" : "Show"} the workflow script`}
                onClick={() => setScriptOpen((value) => !value)}
              >
                Script
              </CollapsibleSectionHeader>
              {scriptOpen ? (
                <WorkflowScript
                  environmentId={environmentId}
                  threadId={threadId}
                  scriptPath={scriptPath}
                />
              ) : null}
            </li>
          )}
        </ul>
      ) : null}
    </li>
  );
}
