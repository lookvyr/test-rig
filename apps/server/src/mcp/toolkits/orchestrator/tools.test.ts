import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Option from "effect/Option";
import { Tool } from "effect/unstable/ai";

import {
  CreateThreadsTool,
  DelegateTaskTool,
  OrchestratorToolkit,
  ScheduleTaskTool,
  ThreadUpdateTool,
} from "./tools.ts";

describe("orchestrator MCP tool guidance", () => {
  it("directs subagent requests to delegation instead of ordinary threads", () => {
    const delegate = DelegateTaskTool.description ?? "";
    assert.include(delegate, "child agent");
    assert.include(delegate, "No parent history");
    assert.include(delegate, "isolation:'worktree'");
    assert.include(delegate, "Keep `taskId`");
    assert.include(CreateThreadsTool.description ?? "", "Not delegation");
    const cancel = OrchestratorToolkit.tools.task_cancel.description ?? "";
    assert.include(cancel, "including later runs in its child thread");
    assert.include(cancel, "A finished task keeps its result");
  });

  it("sends follow-ups to a finished child as a fresh task", () => {
    const send = OrchestratorToolkit.tools.t3_thread_send.description ?? "";
    assert.include(send, "A send to a finished child thread starts a fresh task");
    assert.include(send, "`link` verbatim");
  });

  it("documents wait timeout as a parent budget, not a child failure", () => {
    const schema = Tool.getJsonSchema(DelegateTaskTool) as {
      readonly properties?: Readonly<
        Record<
          string,
          {
            readonly description?: unknown;
            readonly anyOf?: ReadonlyArray<{ readonly description?: unknown }>;
          }
        >
      >;
    };
    const text = (name: string) => {
      const property = schema.properties?.[name];
      return [property?.description, ...(property?.anyOf ?? []).map((entry) => entry.description)]
        .filter((value) => typeof value === "string")
        .join(" ");
    };
    assert.include(text("mode"), "Default 'async'");
    assert.include(text("mode"), "A question or approval ends the wait");
    assert.include(text("timeoutMs"), "does not cancel the child");
  });

  it("publishes one schedule tool that creates or updates", () => {
    const schema = Tool.getJsonSchema(ScheduleTaskTool) as {
      readonly type?: unknown;
      readonly required?: ReadonlyArray<string>;
      readonly properties?: Readonly<Record<string, unknown>>;
    };
    const descriptions: Array<string> = [];
    const collect = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      const node = value as { readonly description?: unknown; readonly anyOf?: unknown };
      if (typeof node.description === "string") descriptions.push(node.description);
      if (Array.isArray(node.anyOf)) node.anyOf.forEach(collect);
    };
    collect(schema.properties?.schedule);

    assert.equal(schema.type, "object");
    assert.isAtLeast(descriptions.length, 1);
    assert.includeMembers(Object.keys(schema.properties ?? {}), [
      "scheduledTaskId",
      "projectId",
      "freshSession",
    ]);
    assert.notInclude(schema.required ?? [], "prompt");
    assert.notInclude(schema.required ?? [], "schedule");
    assert.include(
      ScheduleTaskTool.description ?? "",
      "`scheduledTaskId` updates only given fields",
    );
    assert.notProperty(OrchestratorToolkit.tools, "update_scheduled_task");
  });

  it("publishes thread metadata actions from an object-root schema", () => {
    const schema = Tool.getJsonSchema(ThreadUpdateTool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
    };

    assert.equal(schema.type, "object");
    assert.hasAllKeys(schema.properties ?? {}, ["threadId", "action", "title", "clientRequestId"]);
    assert.include(ThreadUpdateTool.description ?? "", "Workspace and branch cannot change");
  });

  it("annotates tools the way upstream does", () => {
    const tools = OrchestratorToolkit.tools;
    assert.isTrue(Context.get(tools.t3_background_wait.annotations, Tool.Readonly));
    const meta = Context.getOption(tools.request_secret.annotations, Tool.Meta);
    assert.deepEqual(Option.getOrNull(meta), { "anthropic/alwaysLoad": true });
    assert.isTrue(Context.get(tools.t3_thread_read.annotations, Tool.Strict));
    assert.property(tools, "t3_workflow_stop");
    assert.isTrue(Context.get(tools.t3_workflow_stop.annotations, Tool.Destructive));
  });
});
