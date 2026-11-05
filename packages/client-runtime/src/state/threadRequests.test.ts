import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { threadKey } from "./entities.ts";
import { presentThreadShell } from "./models.ts";
import { v2ThreadShell } from "./orchestrationV2TestFixtures.ts";
import { createChildThreadApprovalsAtom, type PendingThreadRequests } from "./threadRequests.ts";
import {
  NodeId,
  ProviderSessionId,
  RuntimeRequestId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { sendApprovalFeedback, type ApprovalResponder } from "./threadRequests.ts";
import { describe, expect, it, vi } from "vite-plus/test";
import { v2Now, v2Projection } from "./orchestrationV2TestFixtures.ts";
import { createQuestionHistoryProjector, derivePendingThreadRequests } from "./threadRequests.ts";

const requestId = RuntimeRequestId.make("async-question");
const nodeId = NodeId.make("async-question-node");
const projection: OrchestrationV2ThreadProjection = {
  ...v2Projection,
  runtimeRequests: [
    {
      id: requestId,
      nodeId,
      providerTurnId: null,
      nativeRequestRef: null,
      kind: "user_input",
      status: "pending",
      responseCapability: { type: "message" },
      createdAt: v2Now,
      resolvedAt: null,
    },
  ],
  turnItems: [
    {
      id: TurnItemId.make("async-question-item"),
      threadId: v2Projection.thread.id,
      runId: null,
      nodeId,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 0,
      status: "completed",
      title: null,
      startedAt: v2Now,
      completedAt: v2Now,
      updatedAt: v2Now,
      type: "user_input_request",
      requestId,
      responseMode: "message",
      questions: [
        {
          id: "next",
          header: "Next",
          question: "What should happen next?",
          required: true,
          allowCustomAnswer: false,
          options: [{ label: "Continue", value: "  continue  ", description: "Resume work" }],
        },
      ],
    },
  ],
};

describe("pending v2 questions", () => {
  it("keeps message responses available after the originating runtime exits", () => {
    expect(projection.providerSessions).toEqual([]);
    expect(derivePendingThreadRequests(projection).userInputs).toEqual([
      {
        requestId,
        createdAt: "2026-06-20T00:00:00.000Z",
        responseCapability: "message",
        responseMode: "message",
        dismissible: true,
        questions: [
          {
            id: "next",
            header: "Next",
            question: "What should happen next?",
            required: true,
            allowCustomAnswer: false,
            multiSelect: false,
            options: [{ label: "Continue", value: "  continue  ", description: "Resume work" }],
          },
        ],
      },
    ]);
  });

  it("only marks asynchronous questions as dismissible", () => {
    const live = {
      ...projection,
      runtimeRequests: projection.runtimeRequests.map((request) => ({
        ...request,
        responseCapability: {
          type: "live" as const,
          providerSessionId: ProviderSessionId.make("live-session"),
        },
      })),
      turnItems: projection.turnItems.map((item) =>
        item.type === "user_input_request" ? { ...item, responseMode: undefined } : item,
      ),
    };
    expect(derivePendingThreadRequests(live).userInputs[0]?.dismissible).toBe(false);
  });

  it("removes answered requests from the composer while retaining their answers in projection data", () => {
    const answered = {
      ...projection,
      runtimeRequests: projection.runtimeRequests.map((request) => ({
        ...request,
        status: "resolved" as const,
        resolvedAt: v2Now,
        answers: { next: "  continue  " },
      })),
    };
    expect(derivePendingThreadRequests(answered).userInputs).toEqual([]);
    expect(answered.runtimeRequests[0]?.answers).toEqual({ next: "  continue  " });
  });
});

it("restores old text answers without mutating history or replacing unchanged rows", () => {
  const project = createQuestionHistoryProjector();
  const item = projection.turnItems[0]!;
  const row = {
    item,
    position: 0,
    sourceItemId: item.id,
    sourceThreadId: item.threadId,
    visibility: "local" as const,
  };
  const rows = [row];
  const pending = { visibleTurnItems: rows, runtimeRequests: projection.runtimeRequests };
  expect(project(pending)).toBe(rows);
  const answered = {
    ...pending,
    runtimeRequests: [
      {
        ...projection.runtimeRequests[0]!,
        status: "resolved" as const,
        answers: { next: "Continue" },
      },
    ],
  };
  const result = project(answered);
  expect(result[0]?.item).toMatchObject({
    questionAnswer: {
      answers: { next: "Continue" },
      attachmentsByQuestionId: {},
      questionTextById: { next: "What should happen next?" },
    },
  });
  expect(row.item).not.toHaveProperty("questionAnswer");
  expect(project(answered)).toBe(result);
  expect(project({ ...answered, visibleTurnItems: [...rows] })[0]).toBe(result[0]);
});

it("sends trimmed approval feedback only to the exact supported live request", async () => {
  const respond = vi.fn<ApprovalResponder>(async () => AsyncResult.success(undefined));
  const pending = derivePendingThreadRequests({
    runtimeRequests: [
      {
        ...projection.runtimeRequests[0]!,
        kind: "command",
        responseCapability: {
          type: "live",
          providerSessionId: ProviderSessionId.make("claude"),
          supportsFeedback: true,
        },
      },
      { ...projection.runtimeRequests[0]!, id: RuntimeRequestId.make("other"), kind: "command" },
    ],
    turnItems: [],
  });
  expect(await sendApprovalFeedback(pending.approvals[0]!, " Safer please. ", respond)).toBe(true);
  expect(respond.mock.calls).toEqual([[requestId, "decline", "Safer please."]]);
  expect(await sendApprovalFeedback(pending.approvals[1]!, "Do not send", respond)).toBe(false);
  expect(
    await sendApprovalFeedback(
      { ...pending.approvals[0]!, responseCapability: "not_resumable" },
      "Expired",
      respond,
    ),
  ).toBe(false);
  expect(await sendApprovalFeedback(pending.approvals[0]!, "  ", respond)).toBe(false);
  expect(respond).toHaveBeenCalledTimes(1);
});

it("loads only child approvals and retains their destination across environments", () => {
  const local = EnvironmentId.make("local");
  const remote = EnvironmentId.make("remote");
  const parent = { environmentId: local, threadId: ThreadId.make("parent") };
  const childId = ThreadId.make("child");
  const children = Atom.make(
    [local, remote].map((environmentId) => ({
      ...presentThreadShell(environmentId, v2ThreadShell),
      id: childId,
      title: environmentId,
      hasPendingApprovals: true,
    })),
  );
  const details = Atom.family((key: string) =>
    Atom.make<PendingThreadRequests | null>({
      approvals: [
        {
          requestId: RuntimeRequestId.make(key),
          requestKind: "command",
          createdAt: "2026-10-19T00:00:00Z",
          responseCapability: "live",
        },
      ],
      userInputs: [],
    }),
  );
  const readDetails = vi.fn((ref: ScopedThreadRef) => details(threadKey(ref)));
  const approvalsAtom = createChildThreadApprovalsAtom({
    childThreadInputsAtom: () => children,
    pendingRequestsAtom: readDetails,
  });
  const registry = AtomRegistry.make();
  const unmount = registry.mount(approvalsAtom(parent));
  const pending = registry.get(approvalsAtom(parent));
  expect(pending.map((entry) => entry.thread)).toEqual(
    [local, remote].map((environmentId) => ({ environmentId, threadId: childId })),
  );
  expect(pending.map((entry) => entry.title)).toEqual(["local", "remote"]);
  registry.set(details(threadKey({ environmentId: remote, threadId: childId })), {
    approvals: [],
    userInputs: [],
  });
  expect(registry.get(approvalsAtom(parent))).toEqual([pending[0]]);
  readDetails.mockClear();
  registry.set(
    children,
    registry
      .get(children)
      .map((child) => ({ ...child, hasPendingApprovals: false, hasPendingUserInput: true })),
  );
  expect(registry.get(approvalsAtom(parent))).toEqual([]);
  expect(readDetails).not.toHaveBeenCalled();
  unmount();
  registry.dispose();
});
