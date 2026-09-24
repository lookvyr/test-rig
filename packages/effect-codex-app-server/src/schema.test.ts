import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import * as CodexSchema from "./schema.ts";

const decodeUserInput = Schema.decodeUnknownSync(
  CodexSchema.SERVER_REQUEST_PARAMS["item/tool/requestUserInput"],
);
const encodeThreadStart = Schema.encodeSync(CodexSchema.CLIENT_REQUEST_PARAMS["thread/start"]);
const encodeClientRequest = Schema.encodeSync(CodexSchema.ClientRequest);

const itemSchemas = [
  ["started notification", CodexSchema.V2ItemStartedNotification__ThreadItem],
  ["completed notification", CodexSchema.V2ItemCompletedNotification__ThreadItem],
  ["read history", CodexSchema.V2ThreadReadResponse__ThreadItem],
  ["resumed history", CodexSchema.V2ThreadResumeResponse__ThreadItem],
  ["forked history", CodexSchema.V2ThreadForkResponse__ThreadItem],
  ["paginated history", CodexSchema.V2ThreadTurnsListResponse__ThreadItem],
] as const;

describe.each(itemSchemas)("Codex 0.156 %s", (_name, schema) => {
  const decode = Schema.decodeUnknownSync(schema);

  it.each(["sendMessage", "followupTask", "interruptAgent", "listAgents"] as const)(
    "preserves interrupted %s activity",
    (tool) => {
      const item = {
        type: "collabAgentToolCall",
        id: "item-1",
        tool,
        status: "interrupted",
        senderThreadId: "thread-1",
        receiverThreadIds: ["child-1"],
        agentsStates: { "child-1": { status: "interrupted" } },
      } as const;
      assert.deepEqual(decode(item), item);
    },
  );

  it("preserves asynchronous agent questions", () => {
    const item = {
      type: "agentMessage",
      id: "item-1",
      text: "Which approach?",
      delivery: "async",
      questions: [{ title: "Choose an approach", options: ["Small", "Large"] }],
    } as const;
    assert.deepEqual(decode(item), item);
  });
});

it("preserves nonblocking tool questions", () => {
  const params = {
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    isBlocking: false,
    questions: [{ id: "approach", header: "Approach", question: "Which approach?" }],
  };
  assert.deepEqual(decodeUserInput(params), params);
});

it("encodes the experimental history mode needed for revert-compatible new threads", () => {
  const params = { historyMode: "paginated" } as const;
  assert.deepEqual(encodeThreadStart(params), params);
  const request = { method: "thread/start", id: 1, params } as const;
  assert.deepEqual(encodeClientRequest(request), request);
});

it("registers methods whose upstream TypeScript declaration uses optional params", () => {
  assert.equal(
    CodexSchema.CLIENT_REQUEST_METHODS["account/rateLimits/read"],
    "account/rateLimits/read",
  );
  assert.strictEqual(
    CodexSchema.CLIENT_REQUEST_PARAMS["account/rateLimits/read"],
    CodexSchema.V2NullableGetAccountRateLimitsParams,
  );
  const decode = Schema.decodeUnknownSync(
    CodexSchema.CLIENT_REQUEST_PARAMS["account/rateLimits/read"],
  );
  assert.equal(decode(null), null);
  assert.deepEqual(decode({}), {});
  assert.strictEqual(
    CodexSchema.CLIENT_REQUEST_RESPONSES["account/rateLimits/read"],
    CodexSchema.V2GetAccountRateLimitsResponse,
  );
});
