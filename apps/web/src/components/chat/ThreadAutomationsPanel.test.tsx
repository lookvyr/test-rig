import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { ThreadAutomationsPanel } from "./ThreadAutomationsPanel";

const mocks = vi.hoisted(() => ({
  tasks: [] as ScheduledTask[],
  error: null as string | null,
  toggle: vi.fn(),
  run: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { ...actual, useState: reactHookHarness.useState, useRef: reactHookHarness.useRef };
});
vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: { tasks: mocks.tasks }, error: mocks.error }),
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    scheduledTasksLive: () => ({}),
    setScheduledTaskEnabled: "toggle",
    runScheduledTaskNow: "run",
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "toggle" ? mocks.toggle : mocks.run),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../settings/ScheduledTasksSettings", () => ({
  scheduleLabel: () => "Every minute",
  relativeLabel: () => "in under a minute",
}));

const environmentId = EnvironmentId.make("environment");
const threadId = ThreadId.make("thread");
const task: ScheduledTask = {
  id: ScheduledTaskId.make("task"),
  title: "Review",
  prompt: "Review changes",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId: ProjectId.make("project"),
  threadId,
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-10-06T12:00:00Z",
  updatedAt: "2026-10-06T12:00:00Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
};
function render() {
  hooks.beginRender();
  return ThreadAutomationsPanel({ environmentId, threadId });
}
function control(label: string) {
  const result = visitElements(render(), (element) => element.props["aria-label"] === label);
  if (!result) throw new Error(`Missing ${label}`);
  return result;
}
describe("bound thread automations", () => {
  beforeEach(() => {
    hooks.reset();
    mocks.tasks = [task];
    mocks.error = null;
    mocks.toggle.mockReset().mockResolvedValue({ _tag: "Success" });
    mocks.run.mockReset().mockResolvedValue({ _tag: "Success" });
    mocks.navigate.mockReset();
  });
  it("hides unrelated tasks but keeps subscription failures visible", () => {
    mocks.tasks = [{ ...task, threadId: ThreadId.make("other-thread") }];
    expect(render()).toBeNull();
    mocks.error = "Disconnected";
    expect(
      visitElements(render(), (element) =>
        String(element.props.children).includes("Could not load automations"),
      ),
    ).not.toBeNull();
  });
  it("pauses with a partial update so other clients' edits stay intact", async () => {
    await (control("Pause Review").props.onCheckedChange as (enabled: boolean) => Promise<void>)(
      false,
    );
    expect(mocks.toggle).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { id: task.id, enabled: false },
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("runs a paused task explicitly and opens its editor in the same environment", async () => {
    mocks.tasks = [{ ...task, enabled: false }];
    await (control("Run Review now").props.onClick as () => Promise<void>)();
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith({ environmentId, input: { id: task.id } });
    (control("Edit Review").props.onClick as () => void)();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/settings/scheduled-tasks",
      search: { environmentId, taskId: task.id },
    });
  });
  it("disables repeated run dispatch while status is running", () => {
    mocks.tasks = [{ ...task, lastRunStatus: "running" }];
    expect(control("Run Review now").props.disabled).toBe(true);
  });
});
