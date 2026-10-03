import { it, assert } from "@effect/vitest";
import { OpenCodeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { checkOpenCode2ProviderStatus } from "./OpenCode2Provider.ts";
import { makeOpenCode2Fixture } from "./OpenCode2TestFixture.ts";

const decodeSettings = Schema.decodeEffect(OpenCodeSettings);

it.effect(
  "waits for a cold native catalog and preserves its models, agents, commands and skills",
  () =>
    Effect.gen(function* () {
      const f = yield* makeOpenCode2Fixture;
      let reads = 0;
      f.behavior.onRequest = (url) => {
        if (url.pathname === "/api/model") {
          if (++reads === 1) {
            f.emit({ id: "catalog-ready", created: 1, type: "model.updated", data: {} });
            return Response.json({ data: [] });
          }
          return Response.json({
            data: [
              {
                id: "test",
                providerID: "local",
                name: "Test model",
                enabled: true,
                variants: [{ id: "fast" }],
              },
              {
                id: "disabled",
                providerID: "local",
                name: "Disabled",
                enabled: false,
                variants: [],
              },
            ],
          });
        }
        if (url.pathname === "/api/provider")
          return Response.json({ data: [{ id: "local", name: "Local" }] });
        if (url.pathname === "/api/skill")
          return Response.json({
            data: [
              { id: "review", name: "Review", path: "/tmp/review", description: "Review changes" },
            ],
          });
      };
      const snapshot = yield* checkOpenCode2ProviderStatus(
        yield* decodeSettings({ enabled: true }),
        "/tmp",
        f.runtime,
      );
      assert.strictEqual(snapshot.status, "ready");
      assert.deepStrictEqual(
        snapshot.models.map((model) => model.slug),
        ["local/test"],
      );
      assert.isTrue(snapshot.slashCommands?.some((command) => command.name === "review"));
      assert.strictEqual(snapshot.skills?.[0]?.name, "review");
      assert.strictEqual(reads, 2);
      assert.strictEqual(f.leases(), 0);
    }),
);
