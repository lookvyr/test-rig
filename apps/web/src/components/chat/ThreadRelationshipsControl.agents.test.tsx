import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  projection: null as unknown,
  navigate: vi.fn(),
  shells: [] as unknown[],
  projects: [] as unknown[],
  configs: new Map<string, unknown>(),
  showTooltips: false,
  command: vi.fn().mockResolvedValue({ _tag: "Success" }),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => state.navigate }));
vi.mock("../../state/entities", () => ({
  useThreadDetail: () => ({ projection: state.projection }),
  useThreadShells: () => state.shells,
  useProjects: () => state.projects,
  useServerConfigs: () => state.configs,
}));
vi.mock("../../lib/archivedThreadsState", () => ({
  useArchivedThreadSnapshots: () => ({ snapshots: [] }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.command }));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, {}, children),
  TooltipPopup: ({ children }: { children: ReactNode }) => (state.showTooltips ? children : null),
}));

import { ThreadRelationshipsPanel } from "./ThreadRelationshipsControl";

let renderer: ReactTestRenderer;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  state.shells = [];
  state.projects = [];
  state.configs.clear();
  state.showTooltips = false;
  state.command.mockClear();
  state.projection = null;
});

it.each(["codex", "claudeAgent", "opencode2"])(
  "stops only active app-owned %s subagents without opening their thread",
  async (driver) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const parent = {
      id: "parent",
      lineage: { relationshipToParent: null },
      activeProviderThreadId: null,
    };
    const child = {
      id: "child",
      title: "Worker",
      lineage: { parentThreadId: "parent", relationshipToParent: "subagent" },
    };
    const agent = {
      id: "agent",
      childThreadId: "child",
      origin: "app_owned",
      driver,
      providerInstanceId: "codex",
      title: "Worker",
      prompt: "Check the change",
      model: "gpt-5.4",
      status: "running",
      progress: null,
      result: null,
      startedAt: DateTime.makeUnsafe("2026-09-16T12:00:00Z"),
      completedAt: null,
      updatedAt: DateTime.makeUnsafe("2026-09-16T12:00:00Z"),
    };
    state.shells = [{ environmentId: "test", source: child }];
    const projection = {
      thread: parent,
      runs: [],
      providerThreads: [],
      providerSessions: [],
      contextTransfers: [],
      subagents: [agent],
    };
    state.projection = projection;
    const panel = (
      <ThreadRelationshipsPanel
        environmentId={EnvironmentId.make("test")}
        threadId={ThreadId.make("parent")}
      />
    );
    await act(async () => {
      renderer = create(panel);
    });
    const stopButton = () => renderer.root.findByProps({ "aria-label": "Stop subagent Worker" });
    await act(async () => stopButton().props.onClick());
    expect(state.command).toHaveBeenCalledWith({
      environmentId: "test",
      input: { threadId: "child" },
    });
    expect(state.navigate).not.toHaveBeenCalled();

    for (const status of ["starting", "running", "waiting"] as const) {
      state.command.mockClear();
      state.shells = [
        {
          environmentId: "test",
          source: {
            ...child,
            activityRunStatus: status,
            activityRunStartedAt: DateTime.makeUnsafe("2026-09-16T12:05:00Z"),
          },
        },
      ];
      state.projection = {
        ...projection,
        subagents: [{ ...agent, origin: "provider_native", status: "completed" }],
      };
      await act(async () => renderer.update(cloneElement(panel)));
      expect(renderer.root.findAllByProps({ "aria-label": "Stop subagent Worker" })).toHaveLength(
        0,
      );
      state.projection = { ...projection, subagents: [{ ...agent, status: "completed" }] };
      await act(async () => renderer.update(cloneElement(panel)));
      await act(async () => stopButton().props.onClick());
      expect(state.command).toHaveBeenCalledTimes(1);
      expect(state.command).toHaveBeenLastCalledWith({
        environmentId: "test",
        input: { threadId: "child" },
      });
    }
    state.shells = [{ environmentId: "test", source: child }];
    for (const status of ["completed", "failed", "interrupted"]) {
      state.projection = { ...projection, subagents: [{ ...agent, status }] };
      await act(async () => renderer.update(cloneElement(panel)));
      expect(renderer.root.findAllByProps({ "aria-label": "Stop subagent Worker" })).toHaveLength(
        0,
      );
    }
    state.projection = { ...projection, subagents: [{ ...agent, startedAt: null }] };
    await act(async () => renderer.update(cloneElement(panel)));
    expect(renderer.root.findAllByProps({ "aria-label": "Stop subagent Worker" })).toHaveLength(0);
    state.projection = {
      ...projection,
      subagents: [{ ...agent, origin: "provider_native", driver: "claudeAgent" }],
    };
    await act(async () => renderer.update(cloneElement(panel)));
    expect(renderer.root.findAllByProps({ "aria-label": "Stop subagent Worker" })).toHaveLength(0);
  },
);
