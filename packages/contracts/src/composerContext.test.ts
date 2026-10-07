import { describe, expect, it } from "vite-plus/test";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { OrchestrationMessageContext, UnknownContextRecord } from "./composerContext.ts";
import { OrchestrationV2Command } from "./orchestrationV2.ts";

const mention = { version: 1, kind: "mention", contextId: "ctx_1", label: "file", path: "file.ts" };
const future = { version: 1, kind: "future-kind", contextId: "ctx_2", label: "future" };
const wireCodec = Schema.toCodecJson(OrchestrationMessageContext);
const encodeContext = Schema.encodeUnknownSync(wireCodec);
const decodeContext = Schema.decodeUnknownSync(wireCodec);
const isUnknownRecord = Schema.is(UnknownContextRecord);
const validateContext = Schema.decodeUnknownExit(Schema.toType(OrchestrationMessageContext));
const commandCodec = Schema.toCodecJson(OrchestrationV2Command);
const encodeCommand = Schema.encodeUnknownSync(commandCodec);
const decodeCommand = Schema.decodeUnknownSync(commandCodec);

describe("context records on the JSON wire", () => {
  it("encodes a message dispatch with valid context despite an unencodable sibling", () => {
    const wire = encodeCommand({
      type: "message.dispatch",
      createdBy: "user",
      creationSource: "web",
      commandId: "c1",
      threadId: "t1",
      messageId: "m1",
      text: "Inspect this file",
      attachments: [],
      context: { version: 1, records: [mention, { ...future, payload: { n: 1n } }] },
      dispatchMode: { type: "start_immediately" },
    });
    const decoded = decodeCommand(JSON.parse(JSON.stringify(wire)));
    expect(decoded.type).toBe("message.dispatch");
    if (decoded.type === "message.dispatch") {
      expect(decoded.text).toBe("Inspect this file");
      expect(decoded.context?.records).toEqual([mention]);
    }
  });

  it.each([
    DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-06T00:00:00Z")),
    Number.NaN,
    { n: undefined },
    { n: 1n },
  ])("omits a non-JSON payload without losing valid context", (payload) => {
    expect(isUnknownRecord({ ...future, payload })).toBe(false);
    const wire = encodeContext({
      version: 1,
      records: [mention, { ...future, payload }],
    });
    expect(decodeContext(wire).records).toEqual([mention]);
  });

  it("retains unknown kinds with JSON payloads", () => {
    const record = { ...future, payload: { values: [1, true, null, "text"] } };
    const wire = encodeContext({ version: 1, records: [record] });
    expect(decodeContext(wire).records).toEqual([record]);
  });

  it("drops records with blank required data or explicit undefined optional fields", () => {
    const review = {
      version: 1,
      kind: "review-comment",
      contextId: "ctx_3",
      label: "review",
      sectionId: "section",
      sectionTitle: "Changes",
      filePath: "file.ts",
      startIndex: 1,
      endIndex: 1,
      rangeLabel: "L1",
      text: "review",
      diff: "+change",
      fenceLanguage: undefined,
    };
    const wire = encodeContext({
      version: 1,
      records: [mention, { ...mention, contextId: "ctx_4", path: " " }, review],
    });
    expect(decodeContext(wire).records).toEqual([mention]);
  });

  it("keeps duplicate and aggregate limits while omitting individual bad records", () => {
    expect(() => decodeContext({ version: 1, records: [mention, mention] })).toThrow();
    expect(() =>
      decodeContext({
        version: 1,
        records: Array.from({ length: 201 }, () => ({})),
      }),
    ).toThrow();
  });

  it("reports a hole as a schema failure rather than throwing inside duplicate validation", () => {
    const result = validateContext({ version: 1, records: [undefined] }, { errors: "all" });
    expect(Exit.isFailure(result) && Cause.hasFails(result.cause)).toBe(true);
  });
});
