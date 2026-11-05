import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";

import {
  claudeProcessEnvironment,
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect(
      "removes inherited session and Electron state without changing host or explicit overrides",
      () =>
        Effect.gen(function* () {
          const host = {
            PATH: "/bin",
            ANTHROPIC_API_KEY: "credential",
            ELECTRON_RUN_AS_NODE: "1",
            CLAUDECODE: "1",
            CLAUDE_CODE_SESSION_ID: "host-session",
            CLAUDE_CODE_MESSAGING_SOCKET: "/socket",
            CLAUDE_CODE_MESSAGING_TOKEN: "host-token",
            CLAUDE_EFFORT: "low",
            CLAUDE_PID: "123",
            CLAUDE_AGENT_SDK_VERSION: "host",
          };
          const clean = claudeProcessEnvironment(host);
          expect(clean).toEqual({ PATH: "/bin", ANTHROPIC_API_KEY: "credential" });
          expect(host.CLAUDE_CODE_SESSION_ID).toBe("host-session");
          const environment = yield* makeClaudeEnvironment(
            { homePath: "" },
            mergeProviderInstanceEnvironment(
              [{ name: "CLAUDE_EFFORT", value: "high", sensitive: false }],
              clean,
            ),
          );
          expect(environment.CLAUDE_EFFORT).toBe("high");
        }),
    );

    it.effect("uses the process home when no Claude home override is configured", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir());

        expect(yield* resolveClaudeHomePath({ homePath: "" })).toBe(resolved);
        expect(yield* makeClaudeEnvironment({ homePath: "" })).toEqual(claudeProcessEnvironment());
      }),
    );

    it.effect("resolves configured Claude HOME and stamps continuation/cache keys with it", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(resolved);
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(`claude:home:${resolved}`);
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${resolved}\0`,
        );
      }),
    );

    it.effect("separates capability probes by cwd", () =>
      Effect.gen(function* () {
        const config = { binaryPath: "claude", homePath: "" };
        const first = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-a");
        const second = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-b");
        expect(first).not.toBe(second);
      }),
    );

    it.effect("keeps continuation compatible across instances with the same Claude HOME", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(NodeOS.homedir());

        expect(yield* makeClaudeContinuationGroupKey({ homePath: "" })).toBe(
          `claude:home:${resolved}`,
        );
      }),
    );
  });
});
