import {
  ProjectId,
  DEFAULT_SERVER_SETTINGS,
  type ServerConfig,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  scheduledTaskDefaultModel,
  scheduledTaskRuntimeMode,
  taskToDraft,
  workspaceFromDraft,
} from "./scheduledTasksSettings.logic";

const legacyTask: ScheduledTask = {
  id: ScheduledTaskId.make("legacy-task"),
  title: "Review issues",
  prompt: "Review open issues",
  enabled: true,
  schedule: { type: "interval", everyMs: 60_000 },
  projectId: ProjectId.make("project"),
  threadId: null,
  workspaceStrategy: { type: "worktree", baseRef: "release" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: "2026-09-17T00:00:00.000Z",
  updatedAt: "2026-09-17T00:00:00.000Z",
  nextRunAt: null,
  lastRunAt: null,
  lastRunStatus: "never",
  lastRunError: null,
  runCount: 0,
};

describe("editing scheduled task branch settings", () => {
  it("keeps an omitted origin flag on the local base branch", () => {
    const draft = taskToDraft(legacyTask);
    expect(draft.baseRef).toBe("release");
    expect(draft.startFromOrigin).toBe(false);
  });

  it.each([true, false])("preserves an explicit origin flag of %s", (startFromOrigin) => {
    const draft = taskToDraft({
      ...legacyTask,
      workspaceStrategy: { type: "worktree", baseRef: "release", startFromOrigin },
    });
    expect(draft.startFromOrigin).toBe(startFromOrigin);
  });
});

describe("scheduled task model defaults", () => {
  const instanceId = ProviderInstanceId.make("codex");
  const projectId = ProjectId.make("project");
  const environmentSelection = {
    instanceId,
    model: "environment-model",
    options: [{ id: "reasoning", value: "high" }],
  };
  const projectSelection = { instanceId, model: "project-model" };
  const config = {
    settings: { ...DEFAULT_SERVER_SETTINGS, defaultModelSelection: environmentSelection },
    providers: [
      {
        instanceId,
        driver: "codex",
        displayName: "Codex",
        enabled: true,
        installed: true,
        status: "ready",
        auth: { status: "authenticated" },
        models: [
          { slug: "first-model", name: "First", isCustom: false, capabilities: null },
          {
            slug: "catalog-default",
            name: "Default",
            isDefault: true,
            isCustom: false,
            capabilities: null,
          },
          { slug: "environment-model", name: "Environment", isCustom: false, capabilities: null },
          { slug: "project-model", name: "Project", isCustom: false, capabilities: null },
        ],
      },
    ],
  } as unknown as ServerConfig;
  const resolve = (
    value: ServerConfig,
    project: { id: typeof projectId; defaultModelSelection?: typeof projectSelection } | null,
  ) =>
    scheduledTaskDefaultModel(
      value.settings,
      project,
      deriveProviderInstanceEntries(value.providers),
    );
  it("uses the environment default with its provider options", () => {
    expect(resolve(config, { id: projectId })).toEqual(environmentSelection);
  });
  it("prefers the project's configured model", () => {
    expect(resolve(config, { id: projectId, defaultModelSelection: projectSelection })).toEqual(
      projectSelection,
    );
    expect(
      resolve(
        {
          ...config,
          settings: {
            ...config.settings,
            projectSettingsOverrides: {
              [projectId]: { defaultModelSelection: projectSelection },
            },
          },
        },
        { id: projectId },
      ),
    ).toEqual(projectSelection);
  });
  it("uses the advertised default instead of catalog order when no default is configured", () => {
    expect(
      resolve({ ...config, settings: { ...config.settings, defaultModelSelection: null } }, null),
    ).toEqual({ instanceId, model: "catalog-default" });
  });
  it("falls back to the environment default when the project provider is unavailable", () => {
    expect(
      resolve(config, {
        id: projectId,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("unavailable"),
          model: "missing",
        },
      }),
    ).toEqual(environmentSelection);
  });
  it("does not choose an implicit model on a disabled provider", () => {
    expect(
      resolve(
        {
          ...config,
          providers: config.providers.map((provider) => ({ ...provider, enabled: false })),
        },
        null,
      ),
    ).toBeNull();
  });
});

describe("editing agent-created tasks", () => {
  it("normalizes a stored single-digit hour for the native time input", () => {
    expect(
      taskToDraft({ ...legacyTask, schedule: { type: "fixed_time", timeOfDay: "9:00" } }).timeOfDay,
    ).toBe("09:00");
  });
  it.each([
    { type: "root", branch: "release" },
    { type: "existing_worktree", worktreePath: "/repo/checkout", branch: "release" },
    { type: "worktree", baseRef: "main", branch: "planned-task", startFromOrigin: false },
  ] as const)("retains the saved branch for $type when editing a title", (workspaceStrategy) => {
    const draft = taskToDraft({ ...legacyTask, workspaceStrategy });
    expect(workspaceFromDraft({ ...draft, title: "Updated title" })).toEqual(workspaceStrategy);
  });
  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "preserves %s permissions and plan mode",
    (runtimeMode) => {
      const draft = taskToDraft({ ...legacyTask, runtimeMode, interactionMode: "plan" });
      expect(draft.runtimeMode).toBe(runtimeMode);
      expect(draft.interactionMode).toBe("plan");
    },
  );
});

describe("scheduled task permission defaults", () => {
  const project = { id: ProjectId.make("supervised-project") };
  const settings = {
    ...DEFAULT_SERVER_SETTINGS,
    defaultRuntimeMode: "full-access" as const,
    projectSettingsOverrides: {
      [project.id]: { defaultRuntimeMode: "approval-required" as const },
    },
  };
  const draft = { editingId: null, runtimeMode: "full-access" as const };
  it("follows selected project defaults until permissions are explicitly chosen", () => {
    expect(scheduledTaskRuntimeMode(settings, null, draft, false)).toBe("full-access");
    expect(scheduledTaskRuntimeMode(settings, project, draft, false)).toBe("approval-required");
    expect(scheduledTaskRuntimeMode(settings, project, draft, true)).toBe("full-access");
  });
  it("keeps saved task permissions when project defaults differ", () => {
    expect(
      scheduledTaskRuntimeMode(settings, project, { ...draft, editingId: "saved-task" }, false),
    ).toBe("full-access");
  });
});
