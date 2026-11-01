import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { SecretRequestAnswerInput } from "./secretRequest.ts";

const sentinel = "private-value-must-not-appear";
describe("private payload validation", () => {
  it("preserves exact values but removes them from malformed RPC diagnostics", () => {
    const input = {
      threadId: "thread-1",
      turnItemId: "item-1",
      answer: { type: "save", secret: ` ${sentinel} ` },
    };
    expect(Schema.decodeUnknownSync(SecretRequestAnswerInput)(input).answer).toEqual(input.answer);
    try {
      Schema.decodeUnknownSync(SecretRequestAnswerInput)({ ...input, threadId: null });
      throw new Error("expected a validation failure");
    } catch (error) {
      expect(String(error)).toContain("Invalid private input");
      expect(String(error)).not.toContain(sentinel);
      expect(JSON.stringify(error)).not.toContain(sentinel);
    }
  });
});
