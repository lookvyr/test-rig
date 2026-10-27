import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";

import { compactJsonSchema, compactToolkit } from "./advertisedJsonSchema.ts";

it("compacts schema noise without changing semantic nulls, union requirements, or literal data", () => {
  expect(
    compactJsonSchema({
      type: "object",
      additionalProperties: true,
      properties: {
        maximum: {
          type: "integer",
          minimum: Number.MIN_SAFE_INTEGER,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        clearable: { anyOf: [{ type: "string" }, { type: "null" }] },
        mode: { anyOf: [{ anyOf: [{ const: "one" }, { const: "two" }] }, { const: "one" }] },
        literal: { const: { additionalProperties: true, maximum: Number.MAX_SAFE_INTEGER } },
        count: { type: "integer", minimum: 1, maximum: 25 },
      },
      anyOf: [
        { properties: { action: { const: "rename" } }, required: ["action", "title"] },
        { properties: { action: { const: "clear" } }, required: ["action"] },
      ],
    }),
  ).toEqual({
    type: "object",
    properties: {
      maximum: { type: "integer" },
      clearable: { anyOf: [{ type: "string" }, { type: "null" }] },
      mode: { anyOf: [{ const: "one" }, { const: "two" }] },
      literal: { const: { additionalProperties: true, maximum: Number.MAX_SAFE_INTEGER } },
      count: { type: "integer", minimum: 1, maximum: 25 },
    },
    anyOf: [
      { properties: { action: { const: "rename" } }, required: ["action", "title"] },
      { properties: { action: { const: "clear" } }, required: ["action"] },
    ],
  });
});

it.effect(
  "registration advertises compact inputs while keeping validation and nullable updates",
  () => {
    const probe = Toolkit.make(
      Tool.make("compact_probe", {
        parameters: Schema.Struct({
          count: Schema.Int,
          label: Schema.optional(Schema.NullOr(Schema.String)),
        }),
        success: Schema.Unknown,
      }),
    );
    const calls: Array<unknown> = [];
    const layer = compactToolkit(probe).pipe(
      Layer.provide(
        probe.toLayer({
          compact_probe: (input) =>
            Effect.sync(() => {
              calls.push(input);
              return input;
            }),
        }),
      ),
      Layer.provideMerge(McpServer.McpServer.layer),
    );
    const client = McpSchema.McpServerClient.of({
      clientId: 1,
      clientCapabilities: {},
      clientInfo: { name: "compact-test", version: "1" },
      protocolVersion: "2025-06-18",
      initializePayload: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "compact-test", version: "1" },
      },
      getClient: Effect.die("unused"),
    });
    return Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const input = server.tools.find(({ tool }) => tool.name === "compact_probe")!.tool
        .inputSchema;
      expect(input.additionalProperties).toBeUndefined();
      const call = (args: unknown) =>
        server.callTool({ name: "compact_probe", arguments: args as Record<string, unknown> });
      expect((yield* call({ count: 1, label: null })).isError).toBe(false);
      expect(calls).toEqual([{ count: 1, label: null }]);
      expect((yield* call({ count: 1.5 }).pipe(Effect.flip))._tag).toBe("InvalidParams");
      expect((yield* call({ count: Number.MAX_SAFE_INTEGER + 1 }).pipe(Effect.flip))._tag).toBe(
        "InvalidParams",
      );
      expect(calls).toHaveLength(1);
    }).pipe(Effect.provideService(McpSchema.McpServerClient, client), Effect.provide(layer));
  },
);
