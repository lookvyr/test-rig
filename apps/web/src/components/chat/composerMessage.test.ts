import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";
import {
  threadContextRecord,
  threadContextReference,
  resolveUserMessageContext,
} from "../../lib/composerContextRecords";
import { formatInlineContextReference } from "../../lib/composerContextReferences";
import { prepareComposerMessage, serializeComposerPrompt } from "./composerMessage";

const environmentId = EnvironmentId.make("local");
const record = threadContextRecord(
  { environmentId, threadId: ThreadId.make("source") },
  "Backend performance",
);
const reference = formatInlineContextReference(threadContextReference(record));

describe("composer reference send boundary", () => {
  it("attaches only records for links still in the prompt", () => {
    const removed = threadContextRecord(
      { environmentId, threadId: ThreadId.make("removed") },
      "Removed",
    );
    const prepared = prepareComposerMessage(`Read ${reference}`, [record, removed], environmentId);
    expect(prepared.error).toBeUndefined();
    expect(prepared.context?.records).toEqual([record]);
    expect(
      projectComposerContextForProvider({
        text: prepared.text,
        records: prepared.context!.records,
      }),
    ).toContain("threadId: source");
    expect(
      prepareComposerMessage("Removed the reference", [record], environmentId).context,
    ).toBeUndefined();
  });

  it("rejects referenced foreign environments without granting unused records", () => {
    const foreign = { ...record, environmentId: EnvironmentId.make("remote") };
    expect(prepareComposerMessage(reference, [foreign], environmentId).error).toContain(
      "this environment",
    );
    expect(prepareComposerMessage("Plain text", [foreign], environmentId)).toEqual({
      text: "Plain text",
    });
  });

  it("does not infer a backing record from a pasted label or link", () => {
    expect(prepareComposerMessage(reference, [], environmentId)).toEqual({ text: reference });
  });

  it("preserves terminal chips and their content alongside thread references", () => {
    const text = serializeComposerPrompt({
      prompt: `Read ${reference}`,
      terminalContexts: [
        {
          id: "terminal-test",
          threadId: ThreadId.make("destination"),
          createdAt: "2026-10-05T00:00:00.000Z",
          terminalId: "main",
          terminalLabel: "Terminal",
          lineStart: 1,
          lineEnd: 2,
          text: "example output",
        },
      ],
      elementContexts: [],
      previewAnnotations: [],
      reviewComments: [],
    });
    const prepared = prepareComposerMessage(text, [record], environmentId);
    const resolved = resolveUserMessageContext(prepared);
    expect(resolved.records.map((record) => record.kind)).toEqual(["terminal", "thread"]);
    expect(resolved.text).toContain("t3-context://v1/terminal/");
    expect(resolved.text).not.toContain("example output");
    const providerText = projectComposerContextForProvider({
      text: prepared.text,
      records: prepared.context!.records,
    });
    expect(providerText).toContain("example output");
    expect(providerText).toContain("threadId: source");
  });
});
