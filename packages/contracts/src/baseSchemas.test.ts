import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { ForwardCompatibleArray, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const isThreadId = Schema.is(ThreadId);
const encodeThreadId = Schema.encodeUnknownSync(ThreadId);
const decodeThreadId = Schema.decodeUnknownSync(ThreadId);
const Named = ForwardCompatibleArray(Schema.Struct({ name: TrimmedNonEmptyString }));
const isNamed = Schema.is(Named);
const decodeNamed = Schema.decodeUnknownSync(Named);
const wrappedNamed = Schema.toCodecJson(Schema.Array(Schema.Unknown).pipe(Schema.decodeTo(Named)));
const encodeWrappedNamed = Schema.encodeUnknownSync(wrappedNamed);
const decodeWrappedNamed = Schema.decodeUnknownSync(wrappedNamed);
const decodeDates = Schema.decodeUnknownSync(
  Schema.toCodecJson(ForwardCompatibleArray(Schema.Struct({ at: Schema.DateTimeUtcFromString }))),
);
const decodeExitArray = Schema.decodeUnknownSync(
  Schema.toCodecJson(
    Schema.Exit(ForwardCompatibleArray(Schema.Literals(["known"])), Schema.String, Schema.Defect()),
  ),
);
const decodeWithDefault = Schema.decodeUnknownSync(
  ForwardCompatibleArray(
    Schema.Struct({
      name: Schema.String,
      count: Schema.optionalKey(Schema.Finite).pipe(
        Schema.withDecodingDefaultKey(Effect.succeed(7)),
      ),
    }),
  ),
);
const decodeTransformedExit = Schema.decodeUnknownSync(
  Schema.toCodecJson(
    Schema.Exit(ForwardCompatibleArray(Schema.FiniteFromString), Schema.String, Schema.Defect()),
  ),
);

describe("trimmed identifiers", () => {
  it.each(["", " ", "\t\n", "\u00a0\u3000"])("rejects blank input %j on every path", (value) => {
    expect(() => ThreadId.make(value)).toThrow();
    expect(isThreadId(value)).toBe(false);
    expect(() => encodeThreadId(value)).toThrow();
    expect(() => decodeThreadId(value)).toThrow();
  });

  it.each(["thread-1", "  a b  ", "\u3000thread-2\n"])("round-trips accepted input %j", (value) => {
    const made = ThreadId.make(value);
    const encoded = encodeThreadId(made);
    expect(encoded).toBe(value.trim());
    expect(decodeThreadId(encoded)).toBe(encoded);
  });

  it("keeps the existing JSON schema", () => {
    expect(Schema.toJsonSchemaDocument(Schema.toType(ThreadId)).schema).toEqual({
      type: "string",
      minLength: 1,
    });
  });
});

describe("ForwardCompatibleArray", () => {
  it("keeps unknown elements from failing a multiplexed RPC exit", () => {
    expect(decodeExitArray({ _tag: "Success", value: ["future", "known"] })).toEqual(
      Exit.succeed(["known"]),
    );
  });
  it("preserves explicit element transformations inside an RPC exit", () => {
    expect(decodeTransformedExit({ _tag: "Success", value: ["1", "invalid", "2"] })).toEqual(
      Exit.succeed([1, 2]),
    );
  });
  it("retains transformed JSON dates and drops unreadable siblings", () => {
    const values = decodeDates([{ at: "2026-10-05T00:00:00.000Z" }, { at: "invalid" }]);
    expect(values).toHaveLength(1);
    expect(DateTime.isDateTime(values[0]?.at)).toBe(true);
  });

  it("applies decoding defaults", () => {
    expect(decodeWithDefault([{ name: "a" }])).toEqual([{ name: "a", count: 7 }]);
  });

  it("drops unencodable entries before an outer JSON array sees them", () => {
    const wire = encodeWrappedNamed([{ name: "a" }, { name: " " }, { name: "b" }]);
    expect(wire).toEqual([{ name: "a" }, { name: "b" }]);
    expect(decodeWrappedNamed(wire)).toEqual(wire);
  });

  it("discards legacy null entries", () => {
    expect(decodeNamed([{ name: "a" }, null, { name: "b" }])).toEqual([
      { name: "a" },
      { name: "b" },
    ]);
  });

  it("rejects holes as decoded values", () => {
    const sparse = [{ name: "a" }];
    sparse.length = 2;
    expect(isNamed([undefined])).toBe(false);
    expect(isNamed(sparse)).toBe(false);
    expect(() => Named.make(sparse)).toThrow();
    expect(isNamed([{ name: "a" }])).toBe(true);
  });
});
