import { assert, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { readProviderWorkspaceCatalog } from "./WorkspaceCatalog.ts";

it.effect(
  "routes repeated workspace reads through the selected instance without refreshing health",
  () =>
    Effect.gen(function* () {
      const reads: Array<[string, string]> = [];
      const first = ProviderInstanceId.make("codex-first");
      const second = ProviderInstanceId.make("codex-second");
      const getInstance = (id: ProviderInstanceId) =>
        Effect.succeed({
          enabled: true,
          getWorkspaceCatalog: (cwd: string) =>
            Effect.sync(() => {
              reads.push([id, cwd]);
              return {
                skills: [{ name: "review", enabled: true, path: `${cwd}/${id}/SKILL.md` }],
                slashCommands: [{ name: id }],
              };
            }),
        });
      for (const [instanceId, cwd] of [
        [first, "/repo/first"],
        [first, "/repo/second"],
        [first, "/worktrees/first"],
        [second, "/repo/first"],
        [first, "/repo/first"],
      ] as const) {
        const catalog = yield* readProviderWorkspaceCatalog({ instanceId, cwd }, getInstance);
        assert.strictEqual(catalog.skills[0]?.path, `${cwd}/${instanceId}/SKILL.md`);
        assert.strictEqual(catalog.slashCommands[0]?.name, instanceId);
      }
      assert.deepEqual(reads, [
        [first, "/repo/first"],
        [first, "/repo/second"],
        [first, "/worktrees/first"],
        [second, "/repo/first"],
        [first, "/repo/first"],
      ]);
    }),
);

it.effect("does not run discovery for disabled, absent, unsupported or unscoped instances", () =>
  Effect.gen(function* () {
    const instanceId = ProviderInstanceId.make("codex-test");
    const disabled = {
      enabled: false,
      getWorkspaceCatalog: () => Effect.die("Disabled discovery ran"),
    };
    const empty = { skills: [], slashCommands: [] };
    for (const instance of [undefined, disabled, { enabled: true }]) {
      assert.deepEqual(
        yield* readProviderWorkspaceCatalog({ instanceId, cwd: "/repo" }, () =>
          Effect.succeed(instance),
        ),
        empty,
      );
    }
    assert.deepEqual(
      yield* readProviderWorkspaceCatalog({ instanceId, cwd: " " }, () =>
        Effect.succeed({ ...disabled, enabled: true }),
      ),
      empty,
    );
  }),
);
