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

it.effect("scopes every native catalog to each selected repository and worktree", () =>
  Effect.gen(function* () {
    const f = yield* makeOpenCode2Fixture;
    const reads: Array<[string, string | null]> = [];
    f.behavior.onRequest = (url) => {
      const cwd = url.searchParams.get("location[directory]");
      if (
        ["/api/model", "/api/agent", "/api/provider", "/api/command", "/api/skill"].includes(
          url.pathname,
        )
      ) {
        reads.push([url.pathname, cwd]);
      }
      if (url.pathname === "/api/model")
        return Response.json({
          data: [{ id: "workspace", providerID: "local", name: cwd, enabled: true, variants: [] }],
        });
      if (url.pathname === "/api/provider")
        return Response.json({ data: [{ id: "local", name: "Local" }] });
      if (url.pathname === "/api/command")
        return Response.json({ data: [{ name: "review", description: cwd }] });
      if (url.pathname === "/api/skill")
        return Response.json({
          data: [{ id: "review", name: "Review", path: `${cwd}/.opencode/skills/review/SKILL.md` }],
        });
    };
    const settings = yield* decodeSettings({ enabled: true });
    for (const cwd of ["/repo/first", "/repo/second", "/worktrees/first", "/repo/first"]) {
      const snapshot = yield* checkOpenCode2ProviderStatus(settings, cwd, f.runtime);
      assert.strictEqual(snapshot.skills[0]?.path, `${cwd}/.opencode/skills/review/SKILL.md`);
      assert.strictEqual(
        snapshot.slashCommands.find((command) => command.name === "review")?.description,
        cwd,
      );
      assert.strictEqual(snapshot.models[0]?.name, cwd);
      for (const path of [
        "/api/model",
        "/api/agent",
        "/api/provider",
        "/api/command",
        "/api/skill",
      ]) {
        assert.isTrue(reads.some(([readPath, readCwd]) => readPath === path && readCwd === cwd));
      }
    }
    assert.strictEqual(f.leases(), 0);
  }),
);
