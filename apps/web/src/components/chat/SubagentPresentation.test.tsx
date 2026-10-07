import {
  EnvironmentId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Subagent,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SubagentTooltipContent } from "./SubagentTooltipContent";
import { SubagentNotificationLink } from "./V2LifecycleRow";
import { formatShortTimestamp } from "../../timestampFormat";

const state = vi.hoisted(() => ({ agents: [] as OrchestrationV2Subagent[] }));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (
    _atom: unknown,
    select: (value: { projection: { subagents: OrchestrationV2Subagent[] } }) => unknown,
  ) => select({ projection: { subagents: state.agents } }),
}));
vi.mock("../../state/threads", () => ({
  environmentThreadDetails: { threadAtom: (ref: unknown) => ref },
}));
vi.mock("../../state/entities", () => ({
  useThreadShell: () => undefined,
  useProject: () => undefined,
}));

const instanceId = ProviderInstanceId.make("codex");
const childThreadId = ThreadId.make("child");
const now = DateTime.makeUnsafe("2026-10-06T12:00:00Z");
const agent: OrchestrationV2Subagent = {
  id: NodeId.make("task"),
  threadId: ThreadId.make("parent"),
  runId: null,
  parentNodeId: NodeId.make("parent-node"),
  origin: "app_owned",
  createdBy: "agent",
  driver: ProviderDriverKind.make("codex"),
  providerInstanceId: instanceId,
  providerThreadId: null,
  childThreadId,
  nativeTaskRef: null,
  prompt: "Inspect the task",
  title: "Package audit",
  model: "gpt-6.1-sol",
  status: "completed",
  result: "Original task result",
  startedAt: now,
  completedAt: now,
  updatedAt: now,
};

const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-06T12:00:00Z",
  models: [
    {
      slug: "gpt-6.1-sol",
      name: "GPT 6.1 Sol",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "serviceTier",
            label: "Speed",
            type: "select",
            currentValue: "default",
            options: [
              { id: "default", label: "Standard" },
              { id: "priority", label: "Fast" },
            ],
          },
        ],
      },
    },
  ],
  slashCommands: [],
  skills: [],
};

beforeEach(() => {
  state.agents = [{ ...agent }];
});

describe("subagent notifications", () => {
  const createdAt = "2026-10-06T12:03:00Z";
  function render(outcome: "completed" | "failed" | "cancelled" | "updated", detail?: string) {
    return renderToStaticMarkup(
      <SubagentNotificationLink
        parentRef={{ environmentId: EnvironmentId.make("local"), threadId: agent.threadId }}
        childThreadId={childThreadId}
        outcome={outcome}
        detail={detail}
        createdAt={createdAt}
        timestampFormat="24-hour"
        providerStatuses={[provider]}
        onOpenThread={() => {}}
        fallback={<span>Generic notification</span>}
      />,
    );
  }

  it.each([
    ["completed", "Finished"],
    ["failed", "Failed"],
    ["cancelled", "Stopped"],
    ["updated", "Updated"],
  ] as const)(
    "keeps %s event outcome, time and supplied detail when live work changes",
    (outcome, label) => {
      state.agents = [{ ...agent, status: "running", result: "New live output" }];
      const markup = render(outcome, "Snapshot result");
      expect(markup).toContain('aria-label="Open Package audit"');
      expect(markup).toContain(`aria-description="${label}"`);
      expect(markup).toContain("Snapshot result");
      expect(markup).not.toContain("New live output");
      expect(markup).toContain(formatShortTimestamp(createdAt, "24-hour"));
    },
  );

  it("uses the originating task result when the notification has no detail", () => {
    expect(render("completed")).toContain("Original task result");
  });

  it("keeps the generic notification when its child record is unavailable", () => {
    state.agents = [];
    expect(render("completed")).toContain("Generic notification");
    expect(render("completed")).not.toContain("Package audit");
  });
});

describe("subagent child traits", () => {
  function render(
    input: {
      origin?: OrchestrationV2Subagent["origin"];
      model?: string;
      instanceId?: ProviderInstanceId;
      serviceTier?: string;
    } = {},
  ) {
    return renderToStaticMarkup(
      <SubagentTooltipContent
        title="Package audit"
        model="gpt-6.1-sol"
        providerInstanceId={instanceId}
        origin={input.origin ?? "app_owned"}
        provider={provider}
        providers={[provider]}
        status="running"
        childThread={{
          branch: null,
          worktreePath: null,
          modelSelection: {
            instanceId: input.instanceId ?? instanceId,
            model: input.model ?? "gpt-6.1-sol",
            options: [
              { id: "reasoningEffort", value: "high" },
              { id: "serviceTier", value: input.serviceTier ?? "priority" },
            ],
          },
        }}
      />,
    );
  }

  it("shows matching app-child effort and speed", () => {
    expect(render()).toContain("high");
    expect(render()).toContain("Fast mode on");
  });

  it.each([
    { origin: "provider_native" as const },
    { instanceId: ProviderInstanceId.make("another-account") },
    { model: "different-model" },
  ])("does not infer child traits from unrelated saved settings: %j", (input) => {
    expect(render(input)).not.toContain("high");
    expect(render(input)).not.toContain("Fast mode on");
  });

  it.each(["default", "unknown-tier"])("does not claim fast speed for %s", (serviceTier) => {
    expect(render({ serviceTier })).not.toContain("Fast mode on");
  });
});
