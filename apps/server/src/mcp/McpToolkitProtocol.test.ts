import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer, Tool, Toolkit } from "effect/unstable/ai";

const ProbeToolkit = Toolkit.make(
  Tool.make("protocol_probe", {
    description: "Checks MCP result classification.",
    parameters: Schema.Struct({ mode: Schema.Literals(["success", "denied", "defect"]) }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    failure: Schema.Struct({ code: Schema.Literal("capability_denied") }),
    failureMode: "return",
  }),
);
const layer = McpServer.toolkit(ProbeToolkit).pipe(
  Layer.provide(
    ProbeToolkit.toLayer({
      protocol_probe: ({ mode }) =>
        mode === "denied"
          ? Effect.fail({ code: "capability_denied" as const })
          : mode === "defect"
            ? Effect.die(new Error("private defect details"))
            : Effect.succeed({ ok: true }),
    }),
  ),
  Layer.provideMerge(McpServer.McpServer.layer),
);
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "protocol-test", version: "1" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "protocol-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

it.effect(
  "real toolkit registration keeps success output and marks declared failures as MCP errors",
  () =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      expect(
        server.tools.find(({ tool }) => tool.name === "protocol_probe")?.tool.outputSchema,
      ).toBeDefined();
      const success = yield* server.callTool({
        name: "protocol_probe",
        arguments: { mode: "success" },
      });
      expect(success.isError).toBe(false);
      expect(success.structuredContent).toEqual({ ok: true });
      const denied = yield* server.callTool({
        name: "protocol_probe",
        arguments: { mode: "denied" },
      });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toBeUndefined();
      expect(denied.content).toEqual([{ type: "text", text: '{"code":"capability_denied"}' }]);
      const defect = yield* server.callTool({
        name: "protocol_probe",
        arguments: { mode: "defect" },
      });
      expect(defect.isError).toBe(true);
      expect(defect.structuredContent).toBeUndefined();
      expect(defect.content).toEqual([
        { type: "text", text: "Tool execution failed due to an internal server error." },
      ]);
    }).pipe(Effect.provideService(McpSchema.McpServerClient, client), Effect.provide(layer)),
);
